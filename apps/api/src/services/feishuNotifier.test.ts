import assert from "node:assert/strict";
import test from "node:test";
import type {
  CrossVenueOpportunityScan,
  CrossVenueScanItem,
  OpportunityScan,
  OpportunityScanItem
} from "../types/market.js";
import {
  buildCrossVenueOpportunityCard,
  buildFeishuTestCard,
  buildRTokenOpportunityCard
} from "./feishuNotifier.js";

function flattenCardText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenCardText).join("\n");
  if (value && typeof value === "object") {
    return Object.values(value).map(flattenCardText).join("\n");
  }
  return "";
}

const rTokenItem = {
  pair: {
    id: "rspcx_spcx",
    name: "RSPCX / SPCX",
    spotSymbol: "RSPCXUSDT",
    futuresSymbol: "SPCXUSDT",
    productType: "USDT-FUTURES",
    spotFeeRate: 0.001,
    futuresFeeRate: 0.0006,
    maxNotionalUsd: 10_000,
    enabled: true
  },
  spotVolumeUsd: 1_000_000,
  evaluation: {
    status: "OPEN",
    opportunityKind: "basis_convergence",
    depthOk: true,
    expectedEdge: 0.0168,
    entryBasis: 0.02,
    fundingRate: 0,
    fundingApr: 0,
    notionalUsd: 5_000,
    spotBuyVwap: 180,
    futuresShortVwap: 183.6,
    reason: "Executable spread",
    analysis: {
      signalSummary: "价差覆盖费用并留有安全垫。",
      riskNotes: ["RToken 与永续合约可能不会按预期速度收敛。"]
    }
  },
  error: null
} as OpportunityScanItem;

const rTokenScan = {
  generatedAt: "2026-07-24T00:00:00.000Z",
  notionalUsd: 5_000,
  requestedLimit: null,
  discoveredPairs: 162,
  scannedPairs: 162,
  openCount: 1,
  basisOpportunityCount: 1,
  fundingOpportunityCount: 0,
  candidateCount: 12,
  closeCount: 0,
  noOpportunityCount: 149,
  depthIssueCount: 0,
  errorCount: 0,
  items: [rTokenItem]
} as OpportunityScan;

const crossVenueItem = {
  pair: {
    id: "skhy_bitget_xyz",
    ticker: "SKHY"
  },
  bitgetQuoteVolume: 1_000_000,
  hyperliquidQuoteVolume: 2_000_000,
  evaluation: {
    status: "OPEN",
    opportunityKind: "spread_convergence",
    direction: "LONG_HYPERLIQUID_SHORT_BITGET",
    longVenue: "hyperliquid_xyz",
    shortVenue: "bitget",
    expectedEdge: 0.009,
    entryBasis: 0.012,
    convergenceGrossEdge: 0.011,
    expectedFundingEdge: 0.0002,
    longEntryVwap: 180,
    shortEntryVwap: 182.2,
    notionalUsd: 5_000,
    depthOk: true,
    reason: "Spread is historically abnormal",
    riskNotes: ["跨交易所双腿不能原子成交。"],
    convergence: {
      medianSignedSpread: 0.001,
      zScore: 3.1,
      absoluteDeviationPercentile: 0.98,
      halfLifeHours: 2.4
    }
  },
  error: null
} as CrossVenueScanItem;

const crossVenueScan = {
  generatedAt: "2026-07-24T00:00:00.000Z",
  notionalUsd: 5_000,
  discoveredPairs: 60,
  scannedPairs: 60,
  openCount: 1,
  watchCount: 4,
  noOpportunityCount: 55,
  depthIssueCount: 0,
  errorCount: 0,
  fundingHorizonHours: 8,
  items: [crossVenueItem]
} as CrossVenueOpportunityScan;

test("builds a structured RToken opportunity card with execution details", () => {
  const card = buildRTokenOpportunityCard(rTokenScan, [rTokenItem]);
  const text = flattenCardText(card);

  assert.equal(card.header.template, "green");
  assert.match(text, /RSPCXUSDT \/ SPCXUSDT/);
  assert.match(text, /预估净 Edge/);
  assert.match(text, /1\.68%/);
  assert.match(text, /打开 Cross Sight/);
});

test("builds a cross-venue convergence card with historical evidence", () => {
  const card = buildCrossVenueOpportunityCard(crossVenueScan, [crossVenueItem]);
  const text = flattenCardText(card);

  assert.equal(card.header.template, "green");
  assert.match(text, /SKHY/);
  assert.match(text, /历史异常价差收敛/);
  assert.match(text, /Z 3\.10/);
  assert.match(text, /半衰期 2\.4 小时/);
});

test("builds a non-trading test card from the current cache summary", () => {
  const card = buildFeishuTestCard({
    generatedAt: "2026-07-24T00:00:00.000Z",
    rTokenOpenCount: 0,
    rTokenCandidateCount: 12,
    crossVenueOpenCount: 0,
    crossVenueWatchCount: 6
  });
  const text = flattenCardText(card);

  assert.equal(card.header.template, "orange");
  assert.match(text, /卡片通知已接通/);
  assert.match(text, /RToken 候选/);
  assert.match(text, /不代表真实行情或可直接交易/);
});
