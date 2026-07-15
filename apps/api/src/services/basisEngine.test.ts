import assert from "node:assert/strict";
import test from "node:test";
import type { FundingRate, FuturesTicker, MarketPairConfig, OrderBook, SpotTicker } from "../types/market.js";
import { evaluateBasisOpportunity } from "./basisEngine.js";

const pair: MarketPairConfig = {
  id: "rspcx_spcx_perp",
  name: "rSPCX spot / SPCX USDT perpetual",
  spotSymbol: "RSPCXUSDT",
  futuresSymbol: "SPCXUSDT",
  productType: "USDT-FUTURES",
  spotFeeRate: 0.001,
  futuresFeeRate: 0.0006,
  maxNotionalUsd: 10_000,
  enabled: true
};

function buildInput(options: {
  fundingRate?: number;
  futuresBid?: number;
  bookSize?: number;
  notionalUsd?: number;
} = {}) {
  const fundingRate = options.fundingRate ?? 0;
  const futuresBid = options.futuresBid ?? 183.6;
  const bookSize = options.bookSize ?? 100;
  const now = Date.now();
  const spotTicker: SpotTicker = {
    symbol: pair.spotSymbol,
    lastPrice: 180,
    bidPrice: 179.5,
    askPrice: 180,
    bidSize: bookSize,
    askSize: bookSize,
    quoteVolume: 12_000_000,
    timestamp: now
  };
  const futuresTicker: FuturesTicker = {
    symbol: pair.futuresSymbol,
    lastPrice: futuresBid,
    bidPrice: futuresBid,
    askPrice: futuresBid + 0.4,
    bidSize: bookSize,
    askSize: bookSize,
    markPrice: futuresBid,
    indexPrice: 180,
    fundingRate,
    openInterest: 100_000,
    quoteVolume: 50_000_000,
    timestamp: now
  };
  const spotBook: OrderBook = {
    bids: [{ price: 179.5, size: bookSize }],
    asks: [{ price: 180, size: bookSize }],
    timestamp: now
  };
  const futuresBook: OrderBook = {
    bids: [{ price: futuresBid, size: bookSize }],
    asks: [{ price: futuresBid + 0.4, size: bookSize }],
    timestamp: now
  };
  const funding: FundingRate = {
    symbol: pair.futuresSymbol,
    fundingRate,
    fundingIntervalHours: 8,
    nextUpdate: now + 8 * 60 * 60 * 1000,
    minFundingRate: -0.005,
    maxFundingRate: 0.005
  };

  return {
    pair,
    notionalUsd: options.notionalUsd ?? 1_206.51,
    spotTicker,
    futuresTicker,
    spotBook,
    futuresBook,
    funding,
    fundingHistory: []
  };
}

test("opens a basis-convergence signal when the spread alone covers round-trip costs", () => {
  const evaluation = evaluateBasisOpportunity(buildInput());

  assert.equal(evaluation.status, "OPEN");
  assert.equal(evaluation.opportunityKind, "basis_convergence");
  assert.equal(evaluation.strategy, "basis_convergence");
  assert.ok(Math.abs(evaluation.entryBasis - 0.02) < 1e-10);
  assert.ok(Math.abs(evaluation.basisEdge - 0.0168) < 1e-10);
  assert.equal(evaluation.negativeFundingBreakEvenPeriods, null);
});

test("allows a negative-funding basis trade only after pricing one funding period", () => {
  const evaluation = evaluateBasisOpportunity(buildInput({ fundingRate: -0.00023 }));

  assert.equal(evaluation.opportunityKind, "basis_convergence");
  assert.ok(Math.abs(evaluation.expectedEdge - 0.01657) < 1e-10);
  assert.ok(Math.abs((evaluation.negativeFundingBreakEvenPeriods ?? 0) - 0.0168 / 0.00023) < 1e-10);
});

test("keeps positive-funding opportunities in the funding-basis strategy", () => {
  const evaluation = evaluateBasisOpportunity(buildInput({ fundingRate: 0.00023 }));

  assert.equal(evaluation.status, "OPEN");
  assert.equal(evaluation.opportunityKind, "executable");
  assert.equal(evaluation.strategy, "funding_basis");
});

test("surfaces a smaller executable basis band when the requested size lacks depth", () => {
  const evaluation = evaluateBasisOpportunity(buildInput({ bookSize: 10, notionalUsd: 5_000 }));

  assert.equal(evaluation.status, "WAIT");
  assert.equal(evaluation.opportunityKind, "watch_small_size");
  assert.equal(evaluation.bestExecutableBand?.notionalUsd, 1_000);
  assert.equal(evaluation.bestExecutableBand?.strategy, "basis_convergence");
});
