import { config } from "../config/env.js";
import type {
  AgentAnalysis,
  BasisEvaluation,
  FundingRate,
  HistoricalFundingRate,
  FundingContext,
  FuturesTicker,
  MarketPairConfig,
  OrderBook,
  OrderBookLevel,
  SpotTicker
} from "../types/market.js";
import { buildAgentAnalysis, narrateBasisEvaluation } from "./agentNarrator.js";
import { getMarketSessionContext } from "./marketSession.js";

type FillResult = {
  vwap: number;
  baseQuantity: number;
  quoteNotional: number;
  filled: boolean;
};

function consumeByQuote(levels: OrderBookLevel[], quoteTarget: number): FillResult {
  let remainingQuote = quoteTarget;
  let baseQuantity = 0;
  let quoteNotional = 0;

  for (const level of levels) {
    const levelQuote = level.price * level.size;
    const quoteAtLevel = Math.min(remainingQuote, levelQuote);
    const baseAtLevel = quoteAtLevel / level.price;

    baseQuantity += baseAtLevel;
    quoteNotional += quoteAtLevel;
    remainingQuote -= quoteAtLevel;

    if (remainingQuote <= 0.000001) break;
  }

  return {
    vwap: baseQuantity > 0 ? quoteNotional / baseQuantity : 0,
    baseQuantity,
    quoteNotional,
    filled: remainingQuote <= 0.000001
  };
}

function consumeByBase(levels: OrderBookLevel[], baseTarget: number): FillResult {
  let remainingBase = baseTarget;
  let baseQuantity = 0;
  let quoteNotional = 0;

  for (const level of levels) {
    const baseAtLevel = Math.min(remainingBase, level.size);

    baseQuantity += baseAtLevel;
    quoteNotional += baseAtLevel * level.price;
    remainingBase -= baseAtLevel;

    if (remainingBase <= 0.000001) break;
  }

  return {
    vwap: baseQuantity > 0 ? quoteNotional / baseQuantity : 0,
    baseQuantity,
    quoteNotional,
    filled: remainingBase <= 0.000001
  };
}

function ensureFinite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function emptyAnalysis(): AgentAnalysis {
  return {
    signalSummary: "",
    fundingSummary: "",
    basisSummary: "",
    riskNotes: [],
    suggestedAction: ""
  };
}

function relativeDeviation(bookPrice: number, tickerPrice: number): number {
  if (bookPrice <= 0 || tickerPrice <= 0) return 0;
  return Math.abs(bookPrice / tickerPrice - 1);
}

function checkBookTickerConsistency(input: {
  label: string;
  book: OrderBook;
  ticker: Pick<SpotTicker | FuturesTicker, "bidPrice" | "askPrice">;
}): string | null {
  const maxDeviation = config.orderBookTickerMaxDeviation;
  const bestBid = input.book.bids[0]?.price ?? 0;
  const bestAsk = input.book.asks[0]?.price ?? 0;
  const bidDeviation = relativeDeviation(bestBid, input.ticker.bidPrice);
  const askDeviation = relativeDeviation(bestAsk, input.ticker.askPrice);
  const worstDeviation = Math.max(bidDeviation, askDeviation);

  if (worstDeviation <= maxDeviation) return null;

  return `${input.label} 盘口与 ticker 偏离 ${pct(worstDeviation)}，超过 ${pct(maxDeviation)} 阈值，疑似 stale book 或交易所数据不一致。`;
}

function withTickerFallback(input: {
  book: OrderBook;
  bidPrice: number;
  bidSize: number;
  askPrice: number;
  askSize: number;
}): OrderBook {
  return {
    bids:
      input.book.bids.length > 0
        ? input.book.bids
        : input.bidPrice > 0 && input.bidSize > 0
          ? [{ price: input.bidPrice, size: input.bidSize }]
          : [],
    asks:
      input.book.asks.length > 0
        ? input.book.asks
        : input.askPrice > 0 && input.askSize > 0
          ? [{ price: input.askPrice, size: input.askSize }]
          : [],
    timestamp: input.book.timestamp
  };
}

export function calculateFundingApr(fundingRate: number, intervalHours: number): number {
  if (intervalHours <= 0) return 0;
  return fundingRate * (24 / intervalHours) * 365;
}

function buildFundingContext(funding: FundingRate, history: HistoricalFundingRate[] = []): FundingContext {
  const sortedHistory = [...history].sort((a, b) => b.fundingTime - a.fundingTime);
  const nonZeroHistory = sortedHistory.filter((row) => row.fundingRate !== 0);
  const recentNonZero = nonZeroHistory[0] ?? null;
  const maxRow =
    sortedHistory.length > 0
      ? sortedHistory.reduce((best, row) => (row.fundingRate > best.fundingRate ? row : best), sortedHistory[0])
      : null;
  const minRow =
    sortedHistory.length > 0
      ? sortedHistory.reduce((best, row) => (row.fundingRate < best.fundingRate ? row : best), sortedHistory[0])
      : null;
  const currentApr = calculateFundingApr(funding.fundingRate, funding.fundingIntervalHours);

  return {
    currentRate: funding.fundingRate,
    intervalHours: funding.fundingIntervalHours,
    currentApr,
    recentNonZeroRate: recentNonZero?.fundingRate ?? null,
    recentNonZeroApr: recentNonZero ? calculateFundingApr(recentNonZero.fundingRate, funding.fundingIntervalHours) : null,
    recentNonZeroTime: recentNonZero?.fundingTime ?? null,
    recentMaxRate: maxRow?.fundingRate ?? null,
    recentMinRate: minRow?.fundingRate ?? null,
    recentMaxApr: maxRow ? calculateFundingApr(maxRow.fundingRate, funding.fundingIntervalHours) : null,
    recentMinApr: minRow ? calculateFundingApr(minRow.fundingRate, funding.fundingIntervalHours) : null,
    recentWindowCount: sortedHistory.length,
    state:
      funding.fundingRate > 0
        ? "active_positive"
        : funding.fundingRate < 0
          ? "active_negative"
          : nonZeroHistory.length > 0
            ? "zero_with_history"
            : "zero"
  };
}

export function evaluateBasisOpportunity(input: {
  pair: MarketPairConfig;
  notionalUsd: number;
  spotTicker: SpotTicker;
  futuresTicker: FuturesTicker;
  spotBook: OrderBook;
  futuresBook: OrderBook;
  funding: FundingRate;
  fundingHistory?: HistoricalFundingRate[];
}): BasisEvaluation {
  const requestedNotional = Math.min(input.notionalUsd, input.pair.maxNotionalUsd);
  const spotBook = withTickerFallback({
    book: input.spotBook,
    bidPrice: input.spotTicker.bidPrice,
    bidSize: input.spotTicker.bidSize,
    askPrice: input.spotTicker.askPrice,
    askSize: input.spotTicker.askSize
  });
  // Fall back to the futures ticker's top-of-book size (not infinite depth):
  // if the merge-depth call failed and the ticker has no size either, the book
  // stays empty so depthOk turns false instead of fabricating a fillable book.
  const futuresBook = withTickerFallback({
    book: input.futuresBook,
    bidPrice: input.futuresTicker.bidPrice,
    bidSize: input.futuresTicker.bidSize,
    askPrice: input.futuresTicker.askPrice,
    askSize: input.futuresTicker.askSize
  });

  // Entry: buy the RToken spot leg from asks, then short the same base size
  // on the perpetual leg by selling into futures bids.
  const spotEntry = consumeByQuote(spotBook.asks, requestedNotional);
  const futuresEntry = consumeByBase(futuresBook.bids, spotEntry.baseQuantity);

  // Exit estimate: sell the spot leg into bids, then buy back the perpetual
  // from asks. This tells us whether an existing basis trade should close.
  const spotExit = consumeByBase(spotBook.bids, spotEntry.baseQuantity);
  const futuresExit = consumeByBase(futuresBook.asks, spotEntry.baseQuantity);

  // entryBasis: futures premium over spot when opening (short futures / long spot).
  // closeBasis: spot-sell vs futures-cover when unwinding — note the numerator/
  // denominator are flipped vs entryBasis, so closeBasis > 0 means the basis has
  // inverted in our favor (spot now sells above where we buy futures back).
  const entryBasis = spotEntry.vwap > 0 && futuresEntry.vwap > 0 ? futuresEntry.vwap / spotEntry.vwap - 1 : 0;
  const closeBasis = spotExit.vwap > 0 && futuresExit.vwap > 0 ? spotExit.vwap / futuresExit.vwap - 1 : 0;
  const fundingApr = calculateFundingApr(input.funding.fundingRate, input.funding.fundingIntervalHours);
  const fundingContext = buildFundingContext(input.funding, input.fundingHistory);
  const marketSession = getMarketSessionContext();

  // Fee drag is a fraction of notional. A full basis trade has FOUR taker fills
  // (open: spot buy + futures sell; close: spot sell + futures buy), so the
  // round-trip cost is 2x the per-leg taker rates. Counting only the entry legs
  // would make expectedEdge optimistic and surface OPEN signals that don't cover
  // the eventual unwind.
  const feeDrag = 2 * (input.pair.spotFeeRate + input.pair.futuresFeeRate);
  // NOTE: expectedEdge mixes a one-time entry basis with a per-period funding
  // accrual (fundingPeriodsToPrice periods) and the round-trip fee. It is a
  // heuristic screen, not a holding-period P&L — tune fundingPeriodsToPrice to
  // the horizon you actually intend to hold.
  const expectedFundingEdge = input.funding.fundingRate * config.fundingPeriodsToPrice;
  const expectedEdge = entryBasis + expectedFundingEdge - feeDrag;
  const priceQualityIssues = [
    checkBookTickerConsistency({
      label: input.pair.spotSymbol,
      book: spotBook,
      ticker: input.spotTicker
    }),
    checkBookTickerConsistency({
      label: input.pair.futuresSymbol,
      book: futuresBook,
      ticker: input.futuresTicker
    })
  ].filter((issue): issue is string => Boolean(issue));
  const priceQualityOk = priceQualityIssues.length === 0;
  const priceQualityReason = priceQualityIssues.join(" ");
  const depthOk =
    priceQualityOk &&
    spotEntry.filled &&
    futuresEntry.filled &&
    spotExit.filled &&
    futuresExit.filled &&
    spotEntry.vwap > 0 &&
    futuresEntry.vwap > 0;

  const status = classifySignal({
    depthOk,
    entryBasis,
    closeBasis,
    expectedEdge,
    fundingRate: input.funding.fundingRate
  });

  const reason = buildReason({
    status,
    depthOk,
    priceQualityOk,
    priceQualityReason,
    entryBasis,
    closeBasis,
    expectedEdge,
    fundingRate: input.funding.fundingRate
  });

  const evaluation: BasisEvaluation = {
    pair: input.pair,
    status,
    notionalUsd: requestedNotional,
    baseQuantity: spotEntry.baseQuantity,
    spotBuyVwap: spotEntry.vwap,
    futuresShortVwap: futuresEntry.vwap,
    spotSellVwap: spotExit.vwap,
    futuresCoverVwap: futuresExit.vwap,
    entryBasis: ensureFinite(entryBasis),
    closeBasis: ensureFinite(closeBasis),
    feeDrag,
    expectedFundingEdge,
    expectedEdge: ensureFinite(expectedEdge),
    fundingRate: input.funding.fundingRate,
    fundingApr,
    fundingContext,
    marketSession,
    analysis: emptyAnalysis(),
    nextFundingTime: input.funding.nextUpdate,
    depthOk,
    reason,
    narratorText: "",
    timestamp: new Date().toISOString(),
    priceQualityOk,
    priceQualityReason
  };

  evaluation.narratorText = narrateBasisEvaluation(evaluation);
  evaluation.analysis = buildAgentAnalysis(evaluation);
  return evaluation;
}

function classifySignal(input: {
  depthOk: boolean;
  entryBasis: number;
  closeBasis: number;
  expectedEdge: number;
  fundingRate: number;
}): BasisEvaluation["status"] {
  if (!input.depthOk) return "WAIT";

  if (input.fundingRate <= 0 || input.closeBasis > 0) {
    return "CLOSE";
  }

  if (input.entryBasis > 0 && input.expectedEdge >= config.openEdgeThreshold && input.fundingRate > 0) {
    return "OPEN";
  }

  if (input.fundingRate > 0 && input.entryBasis > 0) {
    return "HOLD";
  }

  return "WAIT";
}

function buildReason(input: {
  status: BasisEvaluation["status"];
  depthOk: boolean;
  priceQualityOk: boolean;
  priceQualityReason: string | null;
  entryBasis: number;
  closeBasis: number;
  expectedEdge: number;
  fundingRate: number;
}): string {
  if (!input.priceQualityOk) {
    return input.priceQualityReason ?? "盘口与 ticker 偏离过大，先不生成开仓信号。";
  }

  if (!input.depthOk) {
    return "订单簿深度不足，当前名义金额无法完整成交，先不生成开仓信号。";
  }

  if (input.status === "CLOSE") {
    if (input.fundingRate === 0) {
      return "当前资金费率已经归零，不适合为了吃费率新开仓；如果已有仓位，应检查基差和退出成本。";
    }

    return "资金费率转负，或现货退出价格已经优于合约回补价格，适合检查已有仓位是否平掉。";
  }

  if (input.status === "OPEN") {
    return "合约相对 RToken 现货存在溢价，且资金费率为正，扣除手续费后仍达到开仓阈值。";
  }

  if (input.status === "HOLD") {
    return "仍有正资金费率和正基差，但扣除手续费后的 edge 未达到新开仓阈值。";
  }

  return "当前基差、资金费率和费用结构不足以覆盖交易成本。";
}
