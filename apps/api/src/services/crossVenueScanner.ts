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
import { analyzeSpreadConvergence } from "./spreadConvergence.js";
import { alignSpreadCandles, spreadHistoryStore, SpreadHistoryStore } from "./spreadHistoryStore.js";

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

function orderBookMid(book: { bids: Array<{ price: number }>; asks: Array<{ price: number }> }): number {
  const bid = book.bids[0]?.price ?? 0;
  const ask = book.asks[0]?.price ?? 0;
  return bid > 0 && ask > 0 ? (bid + ask) / 2 : bid || ask;
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
  const kindRank = { spread_convergence: 0, funding_carry: 1, snapshot_basis: 2, none: 3 } as const;
  const statusA = a.evaluation?.status ?? "WAIT";
  const statusB = b.evaluation?.status ?? "WAIT";
  return rank[statusA] - rank[statusB] ||
    kindRank[a.evaluation?.opportunityKind ?? "none"] - kindRank[b.evaluation?.opportunityKind ?? "none"] ||
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
  historyStore?: SpreadHistoryStore;
}): Promise<CrossVenueOpportunityScan> {
  const historyStore = input.historyStore ?? spreadHistoryStore;
  historyStore.load();
  const [contracts, bitgetTickers, hyperliquidMarkets] = await Promise.all([
    input.bitget.getFuturesContracts(PRODUCT_TYPE),
    input.bitget.getFuturesTickers(PRODUCT_TYPE),
    input.hyperliquid.getPerpMarkets()
  ]);
  const discovered = discoverCrossVenuePairs({ contracts, bitgetTickers, hyperliquidMarkets });
  const items = await mapWithConcurrency(discovered, CONCURRENCY, async (item): Promise<CrossVenueScanItem> => {
    try {
      const existingHistory = historyStore.get(item.pair.id);
      const needsBootstrap = existingHistory.length < config.crossVenueHistoryMinSamples;
      const candleLimit = Math.min(1000, Math.ceil(config.crossVenueHistoryBootstrapHours * 12) + 2);
      const endTime = Date.now();
      const startTime = endTime - config.crossVenueHistoryBootstrapHours * 60 * 60 * 1000;
      const bootstrapPromise = needsBootstrap
        ? Promise.all([
            input.bitget.getFuturesCandles(item.pair.bitgetSymbol, item.pair.bitgetProductType, "5m", candleLimit),
            input.hyperliquid.getCandles(item.pair.hyperliquidCoin, startTime, endTime, "5m")
          ]).then(([bitgetCandles, hyperliquidCandles]) => alignSpreadCandles(bitgetCandles, hyperliquidCandles))
          .catch((error) => {
            console.error(`Failed to bootstrap spread history for ${item.pair.id}`, error);
            return [];
          })
        : Promise.resolve([]);
      const [bitgetBook, hyperliquidBook, bootstrapSamples] = await Promise.all([
        input.bitget.getFuturesOrderBook(item.pair.bitgetSymbol, item.pair.bitgetProductType),
        input.hyperliquid.getOrderBook(item.pair.hyperliquidCoin),
        bootstrapPromise
      ]);
      if (bootstrapSamples.length > 0) historyStore.merge(item.pair.id, bootstrapSamples);

      const bitgetMid = orderBookMid(bitgetBook);
      const hyperliquidMid = orderBookMid(hyperliquidBook);
      const currentSignedSpread = bitgetMid > 0 && hyperliquidMid > 0 ? Math.log(bitgetMid / hyperliquidMid) : 0;
      const convergenceContext = analyzeSpreadConvergence(historyStore.get(item.pair.id), currentSignedSpread);
      const evaluation = evaluateCrossVenueOpportunity({
        pair: item.pair,
        notionalUsd: input.notionalUsd,
        bitgetBook,
        hyperliquidBook,
        bitgetFundingRate: item.bitgetTicker.fundingRate,
        hyperliquidFundingRate: item.hyperliquidMarket.fundingRate,
        convergenceContext
      });
      historyStore.merge(item.pair.id, [{ timestamp: Date.now(), signedSpread: currentSignedSpread }]);

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
  try {
    historyStore.save();
  } catch (error) {
    console.error("Failed to persist cross-venue spread history", error);
  }
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
