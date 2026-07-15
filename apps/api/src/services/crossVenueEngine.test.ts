import assert from "node:assert/strict";
import test from "node:test";
import type { CrossVenuePair, OrderBook, SpreadConvergenceContext } from "../types/market.js";
import { evaluateCrossVenueOpportunity } from "./crossVenueEngine.js";

const pair: CrossVenuePair = {
  id: "skhy_bitget_xyz",
  ticker: "SKHY",
  bitgetSymbol: "SKHYUSDT",
  bitgetProductType: "USDT-FUTURES",
  hyperliquidCoin: "xyz:SKHY",
  bitgetTakerFeeRate: 0.0006,
  hyperliquidTakerFeeRate: 0.0009,
  bitgetFundingIntervalHours: 8,
  hyperliquidFundingIntervalHours: 1,
  maxNotionalUsd: 10_000
};

function book(bid: number, ask: number, size = 100): OrderBook {
  return {
    bids: [{ price: bid, size }],
    asks: [{ price: ask, size }],
    timestamp: Date.now()
  };
}

function convergenceContext(options: Partial<SpreadConvergenceContext> = {}): SpreadConvergenceContext {
  return {
    historicalReady: true,
    sampleCount: 576,
    windowHours: 48,
    currentSignedSpread: Math.log(1.02),
    medianSignedSpread: Math.log(1.01),
    deviationFromMedian: Math.log(1.02) - Math.log(1.01),
    robustSigma: 0.003,
    zScore: 3.2,
    absoluteDeviationPercentile: 0.98,
    halfLifeHours: 2.5,
    historicalConvergenceRate: 0.72,
    historicalConvergenceObservations: 18,
    isAbnormal: true,
    ...options
  };
}

test("selects long Hyperliquid and short Bitget when Bitget trades at a premium", () => {
  const evaluation = evaluateCrossVenueOpportunity({
    pair,
    notionalUsd: 5_000,
    bitgetBook: book(181.8, 182),
    hyperliquidBook: book(179.8, 180),
    bitgetFundingRate: 0.0001,
    hyperliquidFundingRate: 0,
    fundingHorizonHours: 8
  });

  assert.equal(evaluation.status, "OPEN");
  assert.equal(evaluation.direction, "LONG_HYPERLIQUID_SHORT_BITGET");
  assert.ok(evaluation.entryBasis > 0.009);
  assert.ok(evaluation.expectedEdge > 0.006);
});

test("selects the reverse direction when Hyperliquid trades at a premium", () => {
  const evaluation = evaluateCrossVenueOpportunity({
    pair,
    notionalUsd: 5_000,
    bitgetBook: book(179.8, 180),
    hyperliquidBook: book(181.8, 182),
    bitgetFundingRate: 0,
    hyperliquidFundingRate: 0.0001,
    fundingHorizonHours: 8
  });

  assert.equal(evaluation.status, "OPEN");
  assert.equal(evaluation.direction, "LONG_BITGET_SHORT_HYPERLIQUID");
  assert.ok(evaluation.expectedFundingEdge > 0);
});

test("normalizes hourly Hyperliquid funding to the eight-hour comparison horizon", () => {
  const evaluation = evaluateCrossVenueOpportunity({
    pair,
    notionalUsd: 1_000,
    bitgetBook: book(181.8, 182),
    hyperliquidBook: book(179.8, 180),
    bitgetFundingRate: 0.0002,
    hyperliquidFundingRate: -0.00005,
    fundingHorizonHours: 8
  });

  assert.equal(evaluation.direction, "LONG_HYPERLIQUID_SHORT_BITGET");
  assert.ok(Math.abs(evaluation.expectedFundingEdge - 0.0006) < 1e-10);
});

test("surfaces a smaller executable band when the requested notional exceeds book depth", () => {
  const evaluation = evaluateCrossVenueOpportunity({
    pair,
    notionalUsd: 5_000,
    bitgetBook: book(181.8, 182, 10),
    hyperliquidBook: book(179.8, 180, 10),
    bitgetFundingRate: 0,
    hyperliquidFundingRate: 0,
    fundingHorizonHours: 8
  });

  assert.equal(evaluation.status, "WATCH");
  assert.equal(evaluation.depthOk, false);
  assert.equal(evaluation.bestExecutableBand?.notionalUsd, 1_000);
});

test("opens an independent spread-convergence signal against the learned historical center", () => {
  const evaluation = evaluateCrossVenueOpportunity({
    pair,
    notionalUsd: 5_000,
    bitgetBook: book(102, 102.1),
    hyperliquidBook: book(99.9, 100),
    bitgetFundingRate: 0,
    hyperliquidFundingRate: 0,
    convergenceContext: convergenceContext()
  });

  assert.equal(evaluation.status, "OPEN");
  assert.equal(evaluation.opportunityKind, "spread_convergence");
  assert.equal(evaluation.direction, "LONG_HYPERLIQUID_SHORT_BITGET");
  assert.ok(evaluation.convergenceGrossEdge > 0.009);
  assert.ok(evaluation.convergenceExpectedEdge > 0.006);
});

test("does not call a stable venue premium a historical convergence anomaly", () => {
  const stable = convergenceContext({
    currentSignedSpread: Math.log(1.01),
    medianSignedSpread: Math.log(1.01),
    deviationFromMedian: 0,
    zScore: 0,
    absoluteDeviationPercentile: 0.5,
    isAbnormal: false
  });
  const evaluation = evaluateCrossVenueOpportunity({
    pair,
    notionalUsd: 5_000,
    bitgetBook: book(101, 101.1),
    hyperliquidBook: book(99.9, 100),
    bitgetFundingRate: 0,
    hyperliquidFundingRate: 0,
    convergenceContext: stable
  });

  assert.notEqual(evaluation.opportunityKind, "spread_convergence");
  assert.ok(evaluation.convergenceGrossEdge < 0.001);
});
