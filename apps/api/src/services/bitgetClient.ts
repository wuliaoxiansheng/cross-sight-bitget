import { config } from "../config/env.js";
import type { FundingRate, FuturesTicker, OrderBook, OrderBookLevel, SpotTicker } from "../types/market.js";

type BitgetResponse<T> = {
  code: string;
  msg: string;
  requestTime: number;
  data: T;
};

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeLevels(levels: unknown[]): OrderBookLevel[] {
  return levels
    .map((level) => {
      const [price, size] = level as [string | number, string | number];
      return { price: toNumber(price), size: toNumber(size) };
    })
    .filter((level) => level.price > 0 && level.size > 0);
}

export class BitgetClient {
  constructor(private readonly baseUrl = config.bitgetBaseUrl) {}

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Bitget HTTP ${response.status} for ${path}`);
      }

      const payload = (await response.json()) as BitgetResponse<T>;
      if (payload.code !== "00000") {
        throw new Error(`Bitget API ${payload.code}: ${payload.msg}`);
      }

      return payload.data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getSpotTicker(symbol: string): Promise<SpotTicker> {
    const data = await this.get<Array<Record<string, unknown>>>(`/api/v2/spot/market/tickers?symbol=${symbol}`);
    const ticker = data[0];
    if (!ticker) throw new Error(`Missing spot ticker for ${symbol}`);

    return {
      symbol,
      lastPrice: toNumber(ticker.lastPr),
      bidPrice: toNumber(ticker.bidPr),
      askPrice: toNumber(ticker.askPr),
      bidSize: toNumber(ticker.bidSz),
      askSize: toNumber(ticker.askSz),
      quoteVolume: toNumber(ticker.quoteVolume),
      timestamp: toNumber(ticker.ts)
    };
  }

  async getSpotOrderBook(symbol: string, limit = 50): Promise<OrderBook> {
    const data = await this.get<{ bids: unknown[]; asks: unknown[]; ts: string }>(
      `/api/v2/spot/market/orderbook?symbol=${symbol}&type=step0&limit=${limit}`
    );

    return {
      bids: normalizeLevels(data.bids),
      asks: normalizeLevels(data.asks),
      timestamp: toNumber(data.ts)
    };
  }

  async getFuturesTicker(symbol: string, productType: string): Promise<FuturesTicker> {
    const data = await this.get<Array<Record<string, unknown>>>(
      `/api/v2/mix/market/ticker?symbol=${symbol}&productType=${productType}`
    );
    const ticker = data[0];
    if (!ticker) throw new Error(`Missing futures ticker for ${symbol}`);

    return {
      symbol,
      lastPrice: toNumber(ticker.lastPr),
      bidPrice: toNumber(ticker.bidPr),
      askPrice: toNumber(ticker.askPr),
      markPrice: toNumber(ticker.markPrice),
      indexPrice: toNumber(ticker.indexPrice),
      fundingRate: toNumber(ticker.fundingRate),
      openInterest: toNumber(ticker.holdingAmount),
      quoteVolume: toNumber(ticker.quoteVolume),
      timestamp: toNumber(ticker.ts)
    };
  }

  async getFuturesOrderBook(symbol: string, productType: string, limit = 50): Promise<OrderBook> {
    const data = await this.get<{ bids: unknown[]; asks: unknown[]; ts: string | number }>(
      `/api/v2/mix/market/merge-depth?symbol=${symbol}&productType=${productType}&precision=scale0&limit=${limit}`
    );

    return {
      bids: normalizeLevels(data.bids),
      asks: normalizeLevels(data.asks),
      timestamp: toNumber(data.ts)
    };
  }

  async getCurrentFundingRate(symbol: string, productType: string): Promise<FundingRate> {
    const data = await this.get<Array<Record<string, unknown>>>(
      `/api/v2/mix/market/current-fund-rate?symbol=${symbol}&productType=${productType}`
    );
    const funding = data[0];
    if (!funding) throw new Error(`Missing funding rate for ${symbol}`);

    return {
      symbol,
      fundingRate: toNumber(funding.fundingRate),
      fundingIntervalHours: toNumber(funding.fundingRateInterval, 8),
      nextUpdate: toNumber(funding.nextUpdate),
      minFundingRate: toNumber(funding.minFundingRate),
      maxFundingRate: toNumber(funding.maxFundingRate)
    };
  }
}

