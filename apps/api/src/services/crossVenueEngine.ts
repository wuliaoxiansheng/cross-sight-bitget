import { config } from "../config/env.js";
import type {
  CrossVenueDirection,
  CrossVenueEvaluation,
  CrossVenueExecutionBand,
  CrossVenueName,
  CrossVenuePair,
  OrderBook,
  OrderBookLevel
} from "../types/market.js";

const EXECUTION_BAND_NOTIONALS = [500, 1_000, 2_500, 5_000, 10_000];

type FillResult = {
  vwap: number;
  baseQuantity: number;
  filled: boolean;
};

type DirectionInput = {
  direction: CrossVenueDirection;
  longVenue: CrossVenueName;
  shortVenue: CrossVenueName;
  longBook: OrderBook;
  shortBook: OrderBook;
  longFeeRate: number;
  shortFeeRate: number;
  longFundingRate: number;
  shortFundingRate: number;
  longFundingIntervalHours: number;
  shortFundingIntervalHours: number;
};

function consumeByQuote(levels: OrderBookLevel[], quoteTarget: number): FillResult {
  let remainingQuote = quoteTarget;
  let baseQuantity = 0;
  let quoteNotional = 0;

  for (const level of levels) {
    const quoteAtLevel = Math.min(remainingQuote, level.price * level.size);
    baseQuantity += quoteAtLevel / level.price;
    quoteNotional += quoteAtLevel;
    remainingQuote -= quoteAtLevel;
    if (remainingQuote <= 0.000001) break;
  }

  return {
    vwap: baseQuantity > 0 ? quoteNotional / baseQuantity : 0,
    baseQuantity,
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
    filled: remainingBase <= 0.000001
  };
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function buildDirectionBand(input: DirectionInput, notionalUsd: number, horizonHours: number): CrossVenueExecutionBand {
  const longEntry = consumeByQuote(input.longBook.asks, notionalUsd);
  const shortEntry = consumeByBase(input.shortBook.bids, longEntry.baseQuantity);
  const longExit = consumeByBase(input.longBook.bids, longEntry.baseQuantity);
  const shortExit = consumeByBase(input.shortBook.asks, longEntry.baseQuantity);
  const entryBasis = longEntry.vwap > 0 && shortEntry.vwap > 0 ? shortEntry.vwap / longEntry.vwap - 1 : 0;
  const closeBasis = longExit.vwap > 0 && shortExit.vwap > 0 ? longExit.vwap / shortExit.vwap - 1 : 0;
  const feeDrag = 2 * (input.longFeeRate + input.shortFeeRate);

  // Positive funding is paid by longs and received by shorts. Rates are
  // normalized to the configured horizon because Bitget is commonly 8h while
  // Hyperliquid funding is hourly.
  const expectedFundingEdge =
    input.shortFundingRate * (horizonHours / input.shortFundingIntervalHours) -
    input.longFundingRate * (horizonHours / input.longFundingIntervalHours);
  const expectedEdge = entryBasis + expectedFundingEdge - feeDrag;
  const depthOk =
    longEntry.filled && shortEntry.filled && longExit.filled && shortExit.filled &&
    longEntry.vwap > 0 && shortEntry.vwap > 0;

  return {
    notionalUsd,
    depthOk,
    direction: input.direction,
    longVenue: input.longVenue,
    shortVenue: input.shortVenue,
    baseQuantity: longEntry.baseQuantity,
    longEntryVwap: longEntry.vwap,
    shortEntryVwap: shortEntry.vwap,
    longExitVwap: longExit.vwap,
    shortExitVwap: shortExit.vwap,
    entryBasis: finite(entryBasis),
    closeBasis: finite(closeBasis),
    feeDrag,
    expectedFundingEdge: finite(expectedFundingEdge),
    expectedEdge: finite(expectedEdge)
  };
}

function pickDirection(a: CrossVenueExecutionBand, b: CrossVenueExecutionBand): CrossVenueExecutionBand {
  if (a.depthOk !== b.depthOk) return a.depthOk ? a : b;
  return a.expectedEdge >= b.expectedEdge ? a : b;
}

function isOpen(band: CrossVenueExecutionBand): boolean {
  return band.depthOk && band.entryBasis > 0 && band.expectedEdge >= config.openEdgeThreshold;
}

function scoreBand(band: CrossVenueExecutionBand): number {
  if (!band.depthOk) return 0;
  return Math.max(0, band.expectedEdge * 10_000) + Math.max(0, band.entryBasis * 2_000);
}

export function evaluateCrossVenueOpportunity(input: {
  pair: CrossVenuePair;
  notionalUsd: number;
  bitgetBook: OrderBook;
  hyperliquidBook: OrderBook;
  bitgetFundingRate: number;
  hyperliquidFundingRate: number;
  fundingHorizonHours?: number;
}): CrossVenueEvaluation {
  const requestedNotional = Math.min(input.notionalUsd, input.pair.maxNotionalUsd);
  const horizonHours = input.fundingHorizonHours ?? config.crossVenueFundingHorizonHours;
  const notionals = [...EXECUTION_BAND_NOTIONALS, requestedNotional, input.pair.maxNotionalUsd]
    .map((value) => Math.min(value, input.pair.maxNotionalUsd))
    .filter((value) => value > 0);

  const executionBands = [...new Set(notionals)].sort((a, b) => a - b).map((notionalUsd) => {
    const longHyperliquid = buildDirectionBand({
      direction: "LONG_HYPERLIQUID_SHORT_BITGET",
      longVenue: "hyperliquid_xyz",
      shortVenue: "bitget",
      longBook: input.hyperliquidBook,
      shortBook: input.bitgetBook,
      longFeeRate: input.pair.hyperliquidTakerFeeRate,
      shortFeeRate: input.pair.bitgetTakerFeeRate,
      longFundingRate: input.hyperliquidFundingRate,
      shortFundingRate: input.bitgetFundingRate,
      longFundingIntervalHours: input.pair.hyperliquidFundingIntervalHours,
      shortFundingIntervalHours: input.pair.bitgetFundingIntervalHours
    }, notionalUsd, horizonHours);
    const longBitget = buildDirectionBand({
      direction: "LONG_BITGET_SHORT_HYPERLIQUID",
      longVenue: "bitget",
      shortVenue: "hyperliquid_xyz",
      longBook: input.bitgetBook,
      shortBook: input.hyperliquidBook,
      longFeeRate: input.pair.bitgetTakerFeeRate,
      shortFeeRate: input.pair.hyperliquidTakerFeeRate,
      longFundingRate: input.bitgetFundingRate,
      shortFundingRate: input.hyperliquidFundingRate,
      longFundingIntervalHours: input.pair.bitgetFundingIntervalHours,
      shortFundingIntervalHours: input.pair.hyperliquidFundingIntervalHours
    }, notionalUsd, horizonHours);

    return pickDirection(longHyperliquid, longBitget);
  });

  const requestedBand = executionBands.find((band) => band.notionalUsd === requestedNotional) ?? executionBands[0];
  if (!requestedBand) throw new Error(`No execution band produced for ${input.pair.id}`);

  const openBands = executionBands.filter(isOpen);
  const bestExecutableBand = openBands.sort(
    (a, b) => b.notionalUsd - a.notionalUsd || b.expectedEdge - a.expectedEdge
  )[0] ?? null;
  const requestedOpen = isOpen(requestedBand);
  const hasPositiveEdge = requestedBand.depthOk && requestedBand.expectedEdge > 0 && requestedBand.entryBasis > 0;
  const status = requestedOpen ? "OPEN" : bestExecutableBand ? "WATCH" : hasPositiveEdge ? "WATCH" : "WAIT";
  const opportunityLabel = requestedOpen
    ? "双合约价差机会"
    : bestExecutableBand
      ? `小额可执行 · $${bestExecutableBand.notionalUsd.toLocaleString("en-US")}`
      : hasPositiveEdge
        ? "接近净收益阈值"
        : requestedBand.depthOk
          ? "无机会"
          : "深度不足";
  const directionText = requestedBand.direction === "LONG_HYPERLIQUID_SHORT_BITGET"
    ? "多 Hyperliquid / 空 Bitget"
    : "多 Bitget / 空 Hyperliquid";
  const reason = requestedOpen
    ? `${directionText}，按双边 VWAP、8 小时费率差和四次 taker 成本估算后仍有正 Edge。`
    : bestExecutableBand
      ? `当前金额深度或净 Edge 不足，但 $${bestExecutableBand.notionalUsd.toLocaleString("en-US")} 档位可执行。`
      : `最优方向为${directionText}，但扣除往返手续费及费率影响后未达到开仓阈值。`;

  return {
    pair: input.pair,
    status,
    opportunityLabel,
    opportunityScore: scoreBand(requestedBand),
    direction: requestedBand.direction,
    longVenue: requestedBand.longVenue,
    shortVenue: requestedBand.shortVenue,
    notionalUsd: requestedBand.notionalUsd,
    baseQuantity: requestedBand.baseQuantity,
    longEntryVwap: requestedBand.longEntryVwap,
    shortEntryVwap: requestedBand.shortEntryVwap,
    longExitVwap: requestedBand.longExitVwap,
    shortExitVwap: requestedBand.shortExitVwap,
    entryBasis: requestedBand.entryBasis,
    closeBasis: requestedBand.closeBasis,
    feeDrag: requestedBand.feeDrag,
    expectedFundingEdge: requestedBand.expectedFundingEdge,
    expectedEdge: requestedBand.expectedEdge,
    bitgetFundingRate: input.bitgetFundingRate,
    hyperliquidFundingRate: input.hyperliquidFundingRate,
    fundingHorizonHours: horizonHours,
    depthOk: requestedBand.depthOk,
    reason,
    riskNotes: [
      "两边都是永续合约，需要分别准备保证金，任一侧先强平都会破坏对冲。",
      "跨交易所无法原子成交，实际滑点、延迟和资金费率变化可能吞掉纸面 Edge。",
      "同名 RWA 合约仍可能存在指数源、交易时段或公司行动处理差异，开仓前需复核合约说明。"
    ],
    timestamp: new Date().toISOString(),
    executionBands,
    bestExecutableBand
  };
}
