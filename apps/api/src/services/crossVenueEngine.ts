import { config } from "../config/env.js";
import type {
  CrossVenueDirection,
  CrossVenueEvaluation,
  CrossVenueExecutionBand,
  CrossVenueName,
  CrossVenueOpportunityKind,
  CrossVenuePair,
  OrderBook,
  OrderBookLevel,
  SpreadConvergenceContext
} from "../types/market.js";

const EXECUTION_BAND_NOTIONALS = [500, 1_000, 2_500, 5_000, 10_000];

type FillResult = { vwap: number; baseQuantity: number; filled: boolean };

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
  return { vwap: baseQuantity > 0 ? quoteNotional / baseQuantity : 0, baseQuantity, filled: remainingQuote <= 0.000001 };
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
  return { vwap: baseQuantity > 0 ? quoteNotional / baseQuantity : 0, baseQuantity, filled: remainingBase <= 0.000001 };
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function bookMid(book: OrderBook): number {
  const bid = book.bids[0]?.price ?? 0;
  const ask = book.asks[0]?.price ?? 0;
  return bid > 0 && ask > 0 ? (bid + ask) / 2 : bid || ask;
}

function emptyConvergence(bitgetBook: OrderBook, hyperliquidBook: OrderBook): SpreadConvergenceContext {
  const bitgetMid = bookMid(bitgetBook);
  const hyperliquidMid = bookMid(hyperliquidBook);
  const currentSignedSpread = bitgetMid > 0 && hyperliquidMid > 0 ? Math.log(bitgetMid / hyperliquidMid) : 0;
  return {
    historicalReady: false,
    sampleCount: 0,
    windowHours: 0,
    currentSignedSpread,
    medianSignedSpread: 0,
    deviationFromMedian: currentSignedSpread,
    robustSigma: 0,
    zScore: 0,
    absoluteDeviationPercentile: 0,
    halfLifeHours: null,
    historicalConvergenceRate: null,
    historicalConvergenceObservations: 0,
    isAbnormal: false
  };
}

function directionSign(direction: CrossVenueDirection): 1 | -1 {
  return direction === "LONG_HYPERLIQUID_SHORT_BITGET" ? 1 : -1;
}

function directionMatchesDeviation(direction: CrossVenueDirection, convergence: SpreadConvergenceContext): boolean {
  if (convergence.deviationFromMedian === 0) return false;
  return directionSign(direction) === Math.sign(convergence.deviationFromMedian);
}

function classifyOpportunityKind(input: {
  direction: CrossVenueDirection;
  convergence: SpreadConvergenceContext;
  snapshotExpectedEdge: number;
  expectedFundingEdge: number;
}): CrossVenueOpportunityKind {
  if (input.convergence.isAbnormal && directionMatchesDeviation(input.direction, input.convergence)) {
    return "spread_convergence";
  }
  if (input.snapshotExpectedEdge >= config.openEdgeThreshold) {
    return input.expectedFundingEdge > 0.0005 ? "funding_carry" : "snapshot_basis";
  }
  return "none";
}

function buildDirectionBand(
  input: DirectionInput,
  notionalUsd: number,
  horizonHours: number,
  convergence: SpreadConvergenceContext
): CrossVenueExecutionBand {
  const longEntry = consumeByQuote(input.longBook.asks, notionalUsd);
  const shortEntry = consumeByBase(input.shortBook.bids, longEntry.baseQuantity);
  const longExit = consumeByBase(input.longBook.bids, longEntry.baseQuantity);
  const shortExit = consumeByBase(input.shortBook.asks, longEntry.baseQuantity);
  const entryBasis = longEntry.vwap > 0 && shortEntry.vwap > 0 ? shortEntry.vwap / longEntry.vwap - 1 : 0;
  const closeBasis = longExit.vwap > 0 && shortExit.vwap > 0 ? longExit.vwap / shortExit.vwap - 1 : 0;
  const feeDrag = 2 * (input.longFeeRate + input.shortFeeRate);
  const expectedFundingEdge =
    input.shortFundingRate * (horizonHours / input.shortFundingIntervalHours) -
    input.longFundingRate * (horizonHours / input.longFundingIntervalHours);
  const snapshotExpectedEdge = entryBasis + expectedFundingEdge - feeDrag;

  // The historical center does not have to be zero. If Bitget normally trades
  // 0.4% above Hyperliquid, a 1.5% premium offers about 1.1% of convergence,
  // not the full 1.5% suggested by a zero-basis assumption.
  const targetDirectionalBasis = Math.exp(directionSign(input.direction) * convergence.medianSignedSpread) - 1;
  const convergenceGrossEdge = entryBasis - targetDirectionalBasis;
  const convergenceExpectedEdge = convergenceGrossEdge + expectedFundingEdge - feeDrag;
  const opportunityKind = classifyOpportunityKind({
    direction: input.direction,
    convergence,
    snapshotExpectedEdge,
    expectedFundingEdge
  });
  const expectedEdge = opportunityKind === "spread_convergence" ? convergenceExpectedEdge : snapshotExpectedEdge;
  const depthOk = longEntry.filled && shortEntry.filled && longExit.filled && shortExit.filled &&
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
    snapshotExpectedEdge: finite(snapshotExpectedEdge),
    targetDirectionalBasis: finite(targetDirectionalBasis),
    convergenceGrossEdge: finite(convergenceGrossEdge),
    convergenceExpectedEdge: finite(convergenceExpectedEdge),
    expectedEdge: finite(expectedEdge),
    opportunityKind
  };
}

function pickDirection(a: CrossVenueExecutionBand, b: CrossVenueExecutionBand): CrossVenueExecutionBand {
  if (a.depthOk !== b.depthOk) return a.depthOk ? a : b;
  if (a.opportunityKind === "spread_convergence" && b.opportunityKind !== "spread_convergence") return a;
  if (b.opportunityKind === "spread_convergence" && a.opportunityKind !== "spread_convergence") return b;
  return a.expectedEdge >= b.expectedEdge ? a : b;
}

function isOpen(band: CrossVenueExecutionBand): boolean {
  if (!band.depthOk || band.expectedEdge < config.openEdgeThreshold) return false;
  if (band.opportunityKind === "spread_convergence") return band.convergenceGrossEdge > 0;
  return band.entryBasis > 0 && band.opportunityKind !== "none";
}

function scoreBand(band: CrossVenueExecutionBand, convergence: SpreadConvergenceContext): number {
  if (!band.depthOk) return 0;
  const historyScore = band.opportunityKind === "spread_convergence"
    ? Math.min(40, Math.abs(convergence.zScore) * 10) + convergence.absoluteDeviationPercentile * 20
    : 0;
  return Math.max(0, band.expectedEdge * 10_000) + Math.max(0, band.entryBasis * 2_000) + historyScore;
}

function kindLabel(kind: CrossVenueOpportunityKind): string {
  if (kind === "spread_convergence") return "历史异常价差收敛";
  if (kind === "funding_carry") return "跨市场费率套利";
  if (kind === "snapshot_basis") return "瞬时价差机会";
  return "无机会";
}

export function evaluateCrossVenueOpportunity(input: {
  pair: CrossVenuePair;
  notionalUsd: number;
  bitgetBook: OrderBook;
  hyperliquidBook: OrderBook;
  bitgetFundingRate: number;
  hyperliquidFundingRate: number;
  fundingHorizonHours?: number;
  convergenceContext?: SpreadConvergenceContext;
}): CrossVenueEvaluation {
  const requestedNotional = Math.min(input.notionalUsd, input.pair.maxNotionalUsd);
  const horizonHours = input.fundingHorizonHours ?? config.crossVenueFundingHorizonHours;
  const convergence = input.convergenceContext ?? emptyConvergence(input.bitgetBook, input.hyperliquidBook);
  const notionals = [...EXECUTION_BAND_NOTIONALS, requestedNotional, input.pair.maxNotionalUsd]
    .map((value) => Math.min(value, input.pair.maxNotionalUsd)).filter((value) => value > 0);

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
    }, notionalUsd, horizonHours, convergence);
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
    }, notionalUsd, horizonHours, convergence);
    return pickDirection(longHyperliquid, longBitget);
  });

  const requestedBand = executionBands.find((band) => band.notionalUsd === requestedNotional) ?? executionBands[0];
  if (!requestedBand) throw new Error(`No execution band produced for ${input.pair.id}`);
  const openBands = executionBands.filter(isOpen);
  const bestExecutableBand = openBands.sort((a, b) => b.notionalUsd - a.notionalUsd || b.expectedEdge - a.expectedEdge)[0] ?? null;
  const requestedOpen = isOpen(requestedBand);
  const convergenceWatch = requestedBand.opportunityKind === "spread_convergence";
  const hasPositiveEdge = requestedBand.depthOk && requestedBand.expectedEdge > 0;
  const status = requestedOpen ? "OPEN" : bestExecutableBand || convergenceWatch || hasPositiveEdge ? "WATCH" : "WAIT";
  const opportunityLabel = requestedOpen
    ? kindLabel(requestedBand.opportunityKind)
    : bestExecutableBand
      ? `小额可执行 · $${bestExecutableBand.notionalUsd.toLocaleString("en-US")}`
      : convergenceWatch
        ? `异常偏离 · Z ${convergence.zScore.toFixed(1)}`
        : hasPositiveEdge ? "接近净收益阈值" : !convergence.historicalReady ? "历史样本积累中" : requestedBand.depthOk ? "无机会" : "深度不足";
  const directionText = requestedBand.direction === "LONG_HYPERLIQUID_SHORT_BITGET"
    ? "多 Hyperliquid / 空 Bitget" : "多 Bitget / 空 Hyperliquid";
  const reason = requestedBand.opportunityKind === "spread_convergence"
    ? `${directionText}。当前价差相对历史中枢偏离 ${Math.abs(convergence.zScore).toFixed(2)} 个标准差，若回到历史中枢，扣除费用和 ${horizonHours} 小时费率后的 Edge 约 ${(requestedBand.convergenceExpectedEdge * 100).toFixed(2)}%。`
    : requestedOpen
      ? `${directionText}，按双边 VWAP、费率差和四次 taker 成本估算后仍有正 Edge。`
      : bestExecutableBand
        ? `当前金额深度或净 Edge 不足，但 $${bestExecutableBand.notionalUsd.toLocaleString("en-US")} 档位可执行。`
        : `最优方向为${directionText}，当前没有达到可执行阈值。`;

  return {
    pair: input.pair,
    status,
    opportunityLabel,
    opportunityKind: requestedBand.opportunityKind,
    opportunityScore: scoreBand(requestedBand, convergence),
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
    snapshotExpectedEdge: requestedBand.snapshotExpectedEdge,
    targetDirectionalBasis: requestedBand.targetDirectionalBasis,
    convergenceGrossEdge: requestedBand.convergenceGrossEdge,
    convergenceExpectedEdge: requestedBand.convergenceExpectedEdge,
    expectedEdge: requestedBand.expectedEdge,
    bitgetFundingRate: input.bitgetFundingRate,
    hyperliquidFundingRate: input.hyperliquidFundingRate,
    fundingHorizonHours: horizonHours,
    convergence,
    depthOk: requestedBand.depthOk,
    reason,
    riskNotes: [
      "历史收敛不保证本次收敛；指数源、交易时段或公司行动变化可能导致历史中枢永久迁移。",
      "两边都是永续合约，需要分别准备保证金，任一侧先强平都会破坏对冲。",
      "跨交易所无法原子成交，实际滑点、延迟和资金费率变化可能吞掉纸面 Edge。"
    ],
    timestamp: new Date().toISOString(),
    executionBands,
    bestExecutableBand
  };
}
