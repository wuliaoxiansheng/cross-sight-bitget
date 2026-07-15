import assert from "node:assert/strict";
import test from "node:test";
import type { SpreadHistorySample } from "../types/market.js";
import { analyzeSpreadConvergence } from "./spreadConvergence.js";
import { alignSpreadCandles } from "./spreadHistoryStore.js";

test("detects a mean-reverting extreme spread against a non-zero center", () => {
  const start = Date.now() - 60 * 5 * 60 * 1000;
  const center = 0.004;
  const samples: SpreadHistorySample[] = Array.from({ length: 60 }, (_, index) => ({
    timestamp: start + index * 5 * 60 * 1000,
    signedSpread: center + Math.sin(index / 3) * 0.001
  }));
  const context = analyzeSpreadConvergence(samples, center + 0.004);

  assert.equal(context.historicalReady, true);
  assert.equal(context.isAbnormal, true);
  assert.ok(context.zScore > 2);
  assert.ok(Math.abs(context.medianSignedSpread - center) < 0.0002);
  assert.ok((context.halfLifeHours ?? 100) < 24);
});

test("aligns only matching candle timestamps when bootstrapping history", () => {
  const samples = alignSpreadCandles(
    [{ timestamp: 1000, close: 102 }, { timestamp: 2000, close: 103 }],
    [{ timestamp: 1000, close: 100 }, { timestamp: 3000, close: 101 }]
  );

  assert.equal(samples.length, 1);
  assert.equal(samples[0].timestamp, 1000);
  assert.ok(Math.abs(samples[0].signedSpread - Math.log(1.02)) < 1e-12);
});
