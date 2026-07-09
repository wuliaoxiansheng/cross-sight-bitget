import { config } from "../config/env.js";
import type {
  AgentAnalysis,
  BasisEvaluation,
  ExecutionBand,
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

const EXECUTION_BAND_NOTIONALS = [500, 1_000, 2_500, 5_000, 10_000];
const FUNDING_RETURN_APR_THRESHOLD = 0.1;
const NEAR_EDGE_THRESHOLD = 0;

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

function buildExecutionBand(input: {
  notionalUsd: number;
  spotBook: OrderBook;
  futuresBook: OrderBook;
  fundingRate: number;
  feeDrag: number;
  priceQualityOk: boolean;
}): ExecutionBand {
  const spotEntry = consumeByQuote(input.spotBook.asks, input.notionalUsd);
  const futuresEntry = consumeByBase(input.futuresBook.bids, spotEntry.baseQuantity);
  const spotExit = consumeByBase(input.spotBook.bids, spotEntry.baseQuantity);
  const futuresExit = consumeByBase(input.futuresBook.asks, spotEntry.baseQuantity);
  const entryBasis = spotEntry.vwap > 0 && futuresEntry.vwap > 0 ? futuresEntry.vwap / spotEntry.vwap - 1 : 0;
  const closeBasis = spotExit.vwap > 0 && futuresExit.vwap > 0 ? spotExit.vwap / futuresExit.vwap - 1 : 0;
  const expectedFundingEdge = input.fundingRate * config.fundingPeriodsToPrice;
  const expectedEdge = entryBasis + expectedFundingEdge - input.feeDrag;
  const depthOk =
    input.priceQualityOk &&
    spotEntry.filled &&
    futuresEntry.filled &&
    spotExit.filled &&
    futuresExit.filled &&
    spotEntry.vwap > 0 &&
    futuresEntry.vwap > 0;

  return {
    notionalUsd: input.notionalUsd,
    depthOk,
    baseQuantity: spotEntry.baseQuantity,
    spotBuyVwap: spotEntry.vwap,
    futuresShortVwap: futuresEntry.vwap,
    spotSellVwap: spotExit.vwap,
    futuresCoverVwap: futuresExit.vwap,
    entryBasis: ensureFinite(entryBasis),
    closeBasis: ensureFinite(closeBasis),
    expectedFundingEdge,
    expectedEdge: ensureFinite(expectedEdge)
  };
}

function buildExecutionBands(input: {
  requestedNotional: number;
  maxNotionalUsd: number;
  spotBook: OrderBook;
  futuresBook: OrderBook;
  fundingRate: number;
  feeDrag: number;
  priceQualityOk: boolean;
}): ExecutionBand[] {
  const notionals = [...EXECUTION_BAND_NOTIONALS, input.requestedNotional, input.maxNotionalUsd]
    .map((notional) => Math.min(notional, input.maxNotionalUsd))
    .filter((notional) => notional > 0);
  const uniqueNotionals = [...new Set(notionals)].sort((a, b) => a - b);

  return uniqueNotionals.map((notionalUsd) =>
    buildExecutionBand({
      notionalUsd,
      spotBook: input.spotBook,
      futuresBook: input.futuresBook,
      fundingRate: input.fundingRate,
      feeDrag: input.feeDrag,
      priceQualityOk: input.priceQualityOk
    })
  );
}

function isExecutableBand(band: ExecutionBand, fundingRate: number): boolean {
  return (
    band.depthOk &&
    band.entryBasis > 0 &&
    band.expectedEdge >= config.openEdgeThreshold &&
    fundingRate > 0
  );
}

function pickBestExecutableBand(bands: ExecutionBand[], fundingRate: number): ExecutionBand | null {
  return (
    bands
      .filter((band) => isExecutableBand(band, fundingRate))
      .sort((a, b) => b.notionalUsd - a.notionalUsd || b.expectedEdge - a.expectedEdge)[0] ?? null
  );
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
  const executionBands = buildExecutionBands({
    requestedNotional,
    maxNotionalUsd: input.pair.maxNotionalUsd,
    spotBook,
    futuresBook,
    fundingRate: input.funding.fundingRate,
    feeDrag,
    priceQualityOk
  });
  const bestExecutableBand = pickBestExecutableBand(executionBands, input.funding.fundingRate);
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
  const opportunityKind = classifyOpportunityKind({
    status,
    depthOk,
    priceQualityOk,
    requestedNotional,
    bestExecutableBand,
    entryBasis,
    expectedEdge,
    fundingRate: input.funding.fundingRate,
    fundingContext
  });
  const opportunityLabel = buildOpportunityLabel({
    opportunityKind,
    bestExecutableBand,
    requestedNotional,
    fundingContext,
    expectedEdge
  });
  const opportunityNotes = buildOpportunityNotes({
    opportunityKind,
    bestExecutableBand,
    requestedNotional,
    fundingContext,
    entryBasis,
    expectedEdge
  });
  const opportunityScore = scoreOpportunity({
    opportunityKind,
    bestExecutableBand,
    entryBasis,
    expectedEdge,
    fundingApr,
    fundingContext,
    spotVolumeUsd: input.spotTicker.quoteVolume
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
    opportunityKind,
    opportunityLabel,
    opportunityScore,
    opportunityNotes,
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
    priceQualityReason,
    executionBands,
    bestExecutableBand
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

function classifyOpportunityKind(input: {
  status: BasisEvaluation["status"];
  depthOk: boolean;
  priceQualityOk: boolean;
  requestedNotional: number;
  bestExecutableBand: ExecutionBand | null;
  entryBasis: number;
  expectedEdge: number;
  fundingRate: number;
  fundingContext: FundingContext;
}): BasisEvaluation["opportunityKind"] {
  if (!input.priceQualityOk) return "data_risk";
  if (input.status === "OPEN") return "executable";

  if (input.bestExecutableBand && input.bestExecutableBand.notionalUsd < input.requestedNotional) {
    return "watch_small_size";
  }

  if (
    input.depthOk &&
    input.fundingRate === 0 &&
    (input.fundingContext.recentNonZeroApr ?? 0) >= FUNDING_RETURN_APR_THRESHOLD
  ) {
    return "watch_funding_return";
  }

  if (input.depthOk && input.entryBasis > 0 && input.expectedEdge >= NEAR_EDGE_THRESHOLD) {
    return "watch_near_edge";
  }

  if (input.status === "CLOSE") return "exit_check";
  return "none";
}

function formatMoney(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  });
}

function buildOpportunityLabel(input: {
  opportunityKind: BasisEvaluation["opportunityKind"];
  bestExecutableBand: ExecutionBand | null;
  requestedNotional: number;
  fundingContext: FundingContext;
  expectedEdge: number;
}): string {
  if (input.opportunityKind === "executable") return "可开仓";
  if (input.opportunityKind === "watch_small_size" && input.bestExecutableBand) {
    return `小额可试 ${formatMoney(input.bestExecutableBand.notionalUsd)}`;
  }
  if (input.opportunityKind === "watch_funding_return") {
    return `等费率恢复，最近 APR ${pct(input.fundingContext.recentNonZeroApr ?? 0)}`;
  }
  if (input.opportunityKind === "watch_near_edge") {
    return `接近阈值，差 ${pct(config.openEdgeThreshold - input.expectedEdge)}`;
  }
  if (input.opportunityKind === "exit_check") return "已有仓位检查退出";
  if (input.opportunityKind === "data_risk") return "数据风险";
  return "无明确机会";
}

function buildOpportunityNotes(input: {
  opportunityKind: BasisEvaluation["opportunityKind"];
  bestExecutableBand: ExecutionBand | null;
  requestedNotional: number;
  fundingContext: FundingContext;
  entryBasis: number;
  expectedEdge: number;
}): string[] {
  if (input.opportunityKind === "executable") {
    return ["当前名义金额满足深度、正基差、正资金费率和扣费后 edge。"];
  }

  if (input.opportunityKind === "watch_small_size" && input.bestExecutableBand) {
    return [
      `${formatMoney(input.requestedNotional)} 深度不足或 edge 不够，但 ${formatMoney(
        input.bestExecutableBand.notionalUsd
      )} 档位达到开仓阈值。`,
      `小额档位 edge ${pct(input.bestExecutableBand.expectedEdge)}，开仓基差 ${pct(
        input.bestExecutableBand.entryBasis
      )}。`
    ];
  }

  if (input.opportunityKind === "watch_funding_return") {
    return [
      `当前费率为 0，但最近非零 APR 达到 ${pct(input.fundingContext.recentNonZeroApr ?? 0)}。`,
      "如果下一轮资金费率恢复，同时基差没有被抹平，可以重新进入开仓候选。"
    ];
  }

  if (input.opportunityKind === "watch_near_edge") {
    return [
      `当前仍有正基差 ${pct(input.entryBasis)}，扣费后 edge ${pct(input.expectedEdge)}，离开仓阈值较近。`
    ];
  }

  if (input.opportunityKind === "exit_check") {
    return ["更适合用来检查已有仓位是否退出，不适合作为新增开仓。"];
  }

  if (input.opportunityKind === "data_risk") {
    return ["盘口与 ticker 不一致或深度异常，先按假信号处理。"];
  }

  return ["当前没有足够的基差、费率或深度优势。"];
}

function scoreOpportunity(input: {
  opportunityKind: BasisEvaluation["opportunityKind"];
  bestExecutableBand: ExecutionBand | null;
  entryBasis: number;
  expectedEdge: number;
  fundingApr: number;
  fundingContext: FundingContext;
  spotVolumeUsd: number;
}): number {
  const volumeBoost = Math.min(Math.log10(Math.max(input.spotVolumeUsd, 1)) / 20, 0.5);

  if (input.opportunityKind === "executable") {
    return 100 + input.expectedEdge * 1_000 + Math.max(input.fundingApr, 0) * 2 + volumeBoost;
  }

  if (input.opportunityKind === "watch_small_size" && input.bestExecutableBand) {
    return 80 + input.bestExecutableBand.expectedEdge * 1_000 + volumeBoost;
  }

  if (input.opportunityKind === "watch_funding_return") {
    return 60 + (input.fundingContext.recentNonZeroApr ?? 0) * 10 + input.entryBasis * 100 + volumeBoost;
  }

  if (input.opportunityKind === "watch_near_edge") {
    return 50 + input.expectedEdge * 1_000 + input.entryBasis * 100 + volumeBoost;
  }

  if (input.opportunityKind === "exit_check") {
    return 20 + Math.max(input.fundingContext.recentNonZeroApr ?? 0, 0) + volumeBoost;
  }

  if (input.opportunityKind === "data_risk") return -20;
  return 0 + volumeBoost;
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
