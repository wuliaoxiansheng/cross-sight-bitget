import { config } from "../config/env.js";
import type { HyperliquidPerpMarket, OrderBook, OrderBookLevel } from "../types/market.js";

type HyperliquidUniverseRow = {
  name?: unknown;
  maxLeverage?: unknown;
  onlyIsolated?: unknown;
  isDelisted?: unknown;
};

type HyperliquidContextRow = Record<string, unknown>;

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLevels(levels: unknown[], side: "bids" | "asks"): OrderBookLevel[] {
  return levels
    .map((row) => {
      const level = row as Record<string, unknown>;
      return { price: toNumber(level.px), size: toNumber(level.sz) };
    })
    .filter((level) => level.price > 0 && level.size > 0)
    .sort((a, b) => (side === "bids" ? b.price - a.price : a.price - b.price));
}

export class HyperliquidClient {
  constructor(
    private readonly infoUrl = config.hyperliquidInfoUrl,
    private readonly dex = config.hyperliquidDex
  ) {}

  private async post<T>(body: Record<string, unknown>): Promise<T> {
    const delays = [0, 300, 900];
    let lastError: unknown;

    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (delays[attempt] > 0) await delay(delays[attempt]);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch(this.infoUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Hyperliquid HTTP ${response.status}`);
        return (await response.json()) as T;
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Hyperliquid request failed");
  }

  async getPerpMarkets(): Promise<HyperliquidPerpMarket[]> {
    const payload = await this.post<[{
      universe?: HyperliquidUniverseRow[];
    }, HyperliquidContextRow[]]>({ type: "metaAndAssetCtxs", dex: this.dex });
    const universe = payload[0]?.universe ?? [];
    const contexts = payload[1] ?? [];

    return universe.map((market, index) => {
      const coin = String(market.name ?? "");
      const context = contexts[index] ?? {};
      return {
        coin,
        ticker: coin.includes(":") ? coin.split(":").at(-1) ?? coin : coin,
        maxLeverage: toNumber(market.maxLeverage),
        onlyIsolated: Boolean(market.onlyIsolated),
        isDelisted: Boolean(market.isDelisted),
        markPrice: toNumber(context.markPx),
        midPrice: toNumber(context.midPx, toNumber(context.markPx)),
        oraclePrice: toNumber(context.oraclePx),
        fundingRate: toNumber(context.funding),
        fundingIntervalHours: 1,
        openInterest: toNumber(context.openInterest),
        quoteVolume: toNumber(context.dayNtlVlm)
      };
    }).filter((market) => market.coin && !market.isDelisted && market.midPrice > 0);
  }

  async getOrderBook(coin: string): Promise<OrderBook> {
    const payload = await this.post<{
      time?: unknown;
      levels?: [unknown[], unknown[]];
    }>({ type: "l2Book", coin });
    const [bids = [], asks = []] = payload.levels ?? [];

    return {
      bids: normalizeLevels(bids, "bids"),
      asks: normalizeLevels(asks, "asks"),
      timestamp: toNumber(payload.time)
    };
  }
}
