import { config } from "../config/env.js";
import type {
  CrossVenueOpportunityScan,
  CrossVenuePair,
  CrossVenueScanItem,
  FuturesContractConfig,
  FuturesTicker,
  HyperliquidPerpMarket
} from "../types/market.js";
import { BitgetClient } from "./bitgetClient.js";
import { evaluateCrossVenueOpportunity } from "./crossVenueEngine.js";
import { HyperliquidClient } from "./hyperliquidClient.js";

const PRODUCT_TYPE = "USDT-FUTURES";
const MAX_NOTIONAL_USD = 10_000;
const CONCURRENCY = 8;

type DiscoveredPair = {
  pair: CrossVenuePair;
  bitgetTicker: FuturesTicker;
  hyperliquidMarket: HyperliquidPerpMarket;
};

function tickerMid(ticker: FuturesTicker): number {
  if (ticker.bidPrice > 0 && ticker.askPrice > 0) return (ticker.bidPrice + ticker.askPrice) / 2;
  return ticker.markPrice || ticker.lastPrice;
}

export function discoverCrossVenuePairs(input: {
  contracts: FuturesContractConfig[];
  bitgetTickers: FuturesTicker[];
  hyperliquidMarkets: HyperliquidPerpMarket[];
}): DiscoveredPair[] {
  const tickerBySymbol = new Map(input.bitgetTickers.map((ticker) => [ticker.symbol.toUpperCase(), ticker]));
  const hyperliquidByTicker = new Map(
    input.hyperliquidMarkets.map((market) => [market.ticker.toUpperCase(), market])
  );

  return input.contracts.flatMap((contract) => {
    if (!contract.isRwa || contract.status !== "normal" || contract.symbolType !== "perpetual") return [];
    const bitgetTicker = tickerBySymbol.get(contract.symbol.toUpperCase());
    const hyperliquidMarket = hyperliquidByTicker.get(contract.baseCoin.toUpperCase());
    if (!bitgetTicker || !hyperliquidMarket) return [];

    const bitgetMid = tickerMid(bitgetTicker);
    const ratio = bitgetMid > 0 ? hyperliquidMarket.midPrice / bitgetMid : 0;
    if (ratio < config.crossVenuePriceRatioMin || ratio > config.crossVenuePriceRatioMax) return [];

    return [{
      pair: {
        id: `${contract.baseCoin.toLowerCase()}_bitget_xyz`,
        ticker: contract.baseCoin.toUpperCase(),
        bitgetSymbol: contract.symbol,
        bitgetProductType: PRODUCT_TYPE,
        hyperliquidCoin: hyperliquidMarket.coin,
        bitgetTakerFeeRate: contract.takerFeeRate,
        hyperliquidTakerFeeRate: config.hyperliquidTakerFeeRate,
        bitgetFundingIntervalHours: contract.fundingIntervalHours,
        hyperliquidFundingIntervalHours: hyperliquidMarket.fundingIntervalHours,
        maxNotionalUsd: MAX_NOTIONAL_USD
      },
      bitgetTicker,
      hyperliquidMarket
    }];
  });
}

function sortItems(a: CrossVenueScanItem, b: CrossVenueScanItem): number {
  const rank = { OPEN: 0, WATCH: 1, WAIT: 2 } as const;
  const statusA = a.evaluation?.status ?? "WAIT";
  const statusB = b.evaluation?.status ?? "WAIT";
  return rank[statusA] - rank[statusB] ||
    (b.evaluation?.expectedEdge ?? Number.NEGATIVE_INFINITY) -
      (a.evaluation?.expectedEdge ?? Number.NEGATIVE_INFINITY) ||
    b.bitgetQuoteVolume + b.hyperliquidQuoteVolume - (a.bitgetQuoteVolume + a.hyperliquidQuoteVolume);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export async function scanCrossVenueOpportunities(input: {
  bitget: BitgetClient;
  hyperliquid: HyperliquidClient;
  notionalUsd: number;
}): Promise<CrossVenueOpportunityScan> {
  const [contracts, bitgetTickers, hyperliquidMarkets] = await Promise.all([
    input.bitget.getFuturesContracts(PRODUCT_TYPE),
    input.bitget.getFuturesTickers(PRODUCT_TYPE),
    input.hyperliquid.getPerpMarkets()
  ]);
  const discovered = discoverCrossVenuePairs({ contracts, bitgetTickers, hyperliquidMarkets });
  const items = await mapWithConcurrency(discovered, CONCURRENCY, async (item): Promise<CrossVenueScanItem> => {
    try {
      const [bitgetBook, hyperliquidBook] = await Promise.all([
        input.bitget.getFuturesOrderBook(item.pair.bitgetSymbol, item.pair.bitgetProductType),
        input.hyperliquid.getOrderBook(item.pair.hyperliquidCoin)
      ]);
      const evaluation = evaluateCrossVenueOpportunity({
        pair: item.pair,
        notionalUsd: input.notionalUsd,
        bitgetBook,
        hyperliquidBook,
        bitgetFundingRate: item.bitgetTicker.fundingRate,
        hyperliquidFundingRate: item.hyperliquidMarket.fundingRate
      });

      return {
        pair: item.pair,
        bitgetQuoteVolume: item.bitgetTicker.quoteVolume,
        hyperliquidQuoteVolume: item.hyperliquidMarket.quoteVolume,
        evaluation,
        error: null
      };
    } catch (error) {
      return {
        pair: item.pair,
        bitgetQuoteVolume: item.bitgetTicker.quoteVolume,
        hyperliquidQuoteVolume: item.hyperliquidMarket.quoteVolume,
        evaluation: null,
        error: error instanceof Error ? error.message : "Unknown cross-venue scan error"
      };
    }
  });
  const sorted = items.sort(sortItems);
  const openCount = sorted.filter((item) => item.evaluation?.status === "OPEN").length;
  const watchCount = sorted.filter((item) => item.evaluation?.status === "WATCH").length;
  const errorCount = sorted.filter((item) => item.error).length;

  return {
    generatedAt: new Date().toISOString(),
    notionalUsd: input.notionalUsd,
    discoveredPairs: discovered.length,
    scannedPairs: sorted.length,
    openCount,
    watchCount,
    noOpportunityCount: sorted.length - openCount - watchCount - errorCount,
    depthIssueCount: sorted.filter((item) => item.evaluation && !item.evaluation.depthOk).length,
    errorCount,
    fundingHorizonHours: config.crossVenueFundingHorizonHours,
    items: sorted
  };
}
