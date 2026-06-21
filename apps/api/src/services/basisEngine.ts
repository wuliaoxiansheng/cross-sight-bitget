import { config } from "../config/env.js";
import type {
  BasisEvaluation,
  FundingRate,
  FuturesTicker,
  MarketPairConfig,
  OrderBook,
  OrderBookLevel,
  SpotTicker
} from "../types/market.js";
import { narrateBasisEvaluation } from "./agentNarrator.js";

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

export function evaluateBasisOpportunity(input: {
  pair: MarketPairConfig;
  notionalUsd: number;
  spotTicker: SpotTicker;
  futuresTicker: FuturesTicker;
  spotBook: OrderBook;
  futuresBook: OrderBook;
  funding: FundingRate;
}): BasisEvaluation {
  const requestedNotional = Math.min(input.notionalUsd, input.pair.maxNotionalUsd);
  const spotBook = withTickerFallback({
    book: input.spotBook,
    bidPrice: input.spotTicker.bidPrice,
    bidSize: input.spotTicker.bidSize,
    askPrice: input.spotTicker.askPrice,
    askSize: input.spotTicker.askSize
  });
  const futuresBook = withTickerFallback({
    book: input.futuresBook,
    bidPrice: input.futuresTicker.bidPrice,
    bidSize: Number.POSITIVE_INFINITY,
    askPrice: input.futuresTicker.askPrice,
    askSize: Number.POSITIVE_INFINITY
  });

  // Entry: buy the RToken spot leg from asks, then short the same base size
  // on the perpetual leg by selling into futures bids.
  const spotEntry = consumeByQuote(spotBook.asks, requestedNotional);
  const futuresEntry = consumeByBase(futuresBook.bids, spotEntry.baseQuantity);

  // Exit estimate: sell the spot leg into bids, then buy back the perpetual
  // from asks. This tells us whether an existing basis trade should close.
  const spotExit = consumeByBase(spotBook.bids, spotEntry.baseQuantity);
  const futuresExit = consumeByBase(futuresBook.asks, spotEntry.baseQuantity);

  const entryBasis = spotEntry.vwap > 0 && futuresEntry.vwap > 0 ? futuresEntry.vwap / spotEntry.vwap - 1 : 0;
  const closeBasis = spotExit.vwap > 0 && futuresExit.vwap > 0 ? spotExit.vwap / futuresExit.vwap - 1 : 0;
  const fundingApr = calculateFundingApr(input.funding.fundingRate, input.funding.fundingIntervalHours);

  // Fee drag is expressed as a percentage of notional, so it can be compared
  // directly with entry basis and funding edge.
  const feeDrag = input.pair.spotFeeRate + input.pair.futuresFeeRate;
  const expectedFundingEdge = input.funding.fundingRate * config.fundingPeriodsToPrice;
  const expectedEdge = entryBasis + expectedFundingEdge - feeDrag;
  const depthOk =
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
    nextFundingTime: input.funding.nextUpdate,
    depthOk,
    reason,
    narratorText: "",
    timestamp: new Date().toISOString()
  };

  evaluation.narratorText = narrateBasisEvaluation(evaluation);
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
  entryBasis: number;
  closeBasis: number;
  expectedEdge: number;
  fundingRate: number;
}): string {
  if (!input.depthOk) {
    return "订单簿深度不足，当前名义金额无法完整成交，先不生成开仓信号。";
  }

  if (input.status === "CLOSE") {
    return "资金费率归零/转负，或现货退出价格已经优于合约回补价格，适合检查已有仓位是否平掉。";
  }

  if (input.status === "OPEN") {
    return "合约相对 RToken 现货存在溢价，且资金费率为正，扣除手续费后仍达到开仓阈值。";
  }

  if (input.status === "HOLD") {
    return "仍有正资金费率和正基差，但扣除手续费后的 edge 未达到新开仓阈值。";
  }

  return "当前基差、资金费率和费用结构不足以覆盖交易成本。";
}
