import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "../config/env.js";
import type { PriceCandle, SpreadHistorySample } from "../types/market.js";

type PersistedHistory = {
  version: 1;
  pairs: Record<string, SpreadHistorySample[]>;
};

export function alignSpreadCandles(bitget: PriceCandle[], hyperliquid: PriceCandle[]): SpreadHistorySample[] {
  const hyperliquidByTimestamp = new Map(hyperliquid.map((candle) => [candle.timestamp, candle.close]));
  return bitget.flatMap((candle) => {
    const hyperliquidClose = hyperliquidByTimestamp.get(candle.timestamp);
    if (!hyperliquidClose || candle.close <= 0) return [];
    return [{ timestamp: candle.timestamp, signedSpread: Math.log(candle.close / hyperliquidClose) }];
  });
}

export class SpreadHistoryStore {
  private readonly filePath: string;
  private readonly pairs = new Map<string, SpreadHistorySample[]>();
  private loaded = false;

  constructor(filePath = config.crossVenueHistoryPath) {
    this.filePath = resolve(process.cwd(), filePath);
  }

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.filePath)) return;

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as PersistedHistory;
      for (const [pairId, samples] of Object.entries(parsed.pairs ?? {})) {
        this.pairs.set(pairId, this.prune(samples));
      }
    } catch (error) {
      console.error("Failed to load cross-venue spread history", error);
    }
  }

  get(pairId: string): SpreadHistorySample[] {
    this.load();
    return [...(this.pairs.get(pairId) ?? [])];
  }

  merge(pairId: string, incoming: SpreadHistorySample[]): void {
    this.load();
    const byTimestamp = new Map<number, SpreadHistorySample>();
    for (const sample of [...(this.pairs.get(pairId) ?? []), ...incoming]) {
      if (sample.timestamp > 0 && Number.isFinite(sample.signedSpread)) byTimestamp.set(sample.timestamp, sample);
    }
    this.pairs.set(pairId, this.prune([...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp)));
  }

  save(): void {
    this.load();
    const pairs = Object.fromEntries(this.pairs.entries());
    const payload: PersistedHistory = { version: 1, pairs };
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(payload), "utf8");
    renameSync(temporaryPath, this.filePath);
  }

  private prune(samples: SpreadHistorySample[]): SpreadHistorySample[] {
    const cutoff = Date.now() - config.crossVenueHistoryDays * 24 * 60 * 60 * 1000;
    return samples.filter((sample) => sample.timestamp >= cutoff);
  }
}

export const spreadHistoryStore = new SpreadHistoryStore();
