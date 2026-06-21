import type { FundingRate, OpportunityScan, OpportunityScanItem } from "../types/market.js";
import { evaluateBasisOpportunity } from "./basisEngine.js";
import { BitgetClient } from "./bitgetClient.js";
import { discoverRTokenPairs } from "./rtokenDiscovery.js";

const MAX_SCAN_LIMIT = 100;
const SCAN_CONCURRENCY = 10;

function fallbackFunding(symbol: string, fundingRate: number): FundingRate {
  return {
    symbol,
    fundingRate,
    fundingIntervalHours: 8,
    nextUpdate: 0,
    minFundingRate: -0.001,
    maxFundingRate: 0.001
  };
}

async function fallbackFundingHistory() {
  return [];
}

function sortItems(a: OpportunityScanItem, b: OpportunityScanItem): number {
  const rank = {
    OPEN: 0,
    CLOSE: 1,
    HOLD: 2,
    WAIT: 3,
    ERROR: 4
  };

  const aStatus = a.evaluation?.status ?? "ERROR";
  const bStatus = b.evaluation?.status ?? "ERROR";
  const rankDiff = rank[aStatus] - rank[bStatus];
  if (rankDiff !== 0) return rankDiff;

  return (b.evaluation?.expectedEdge ?? -999) - (a.evaluation?.expectedEdge ?? -999);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];

  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    results.push(...(await Promise.all(batch.map(mapper))));
  }

  return results;
}

export async function scanRTokenOpportunities(input: {
  bitget: BitgetClient;
  limit: number;
  notionalUsd: number;
}): Promise<OpportunityScan> {
  const safeLimit = Math.max(1, Math.min(input.limit, MAX_SCAN_LIMIT));
  const discoveredPairs = await discoverRTokenPairs(input.bitget, safeLimit);

  const items = await mapWithConcurrency(
    discoveredPairs,
    SCAN_CONCURRENCY,
    async (discovered): Promise<OpportunityScanItem> => {
      try {
        const [spotBook, futuresBook, funding, fundingHistory] = await Promise.all([
          input.bitget.getSpotOrderBook(discovered.pair.spotSymbol),
          input.bitget.getFuturesOrderBook(discovered.pair.futuresSymbol, discovered.pair.productType),
          input.bitget
            .getCurrentFundingRate(discovered.pair.futuresSymbol, discovered.pair.productType)
            .catch(() => fallbackFunding(discovered.pair.futuresSymbol, discovered.futuresTicker.fundingRate)),
          input.bitget
            .getFundingRateHistory(discovered.pair.futuresSymbol, discovered.pair.productType, 10)
            .catch(fallbackFundingHistory)
        ]);

        const evaluation = evaluateBasisOpportunity({
          pair: discovered.pair,
          notionalUsd: input.notionalUsd,
          spotTicker: discovered.spotTicker,
          spotBook,
          futuresTicker: discovered.futuresTicker,
          futuresBook,
          funding,
          fundingHistory
        });

        return {
          pair: discovered.pair,
          spotVolumeUsd: discovered.spotVolumeUsd,
          evaluation,
          error: null
        };
      } catch (error) {
        return {
          pair: discovered.pair,
          spotVolumeUsd: discovered.spotVolumeUsd,
          evaluation: null,
          error: error instanceof Error ? error.message : "Unknown scan error"
        };
      }
    }
  );

  const sortedItems = items.sort(sortItems);
  const openCount = sortedItems.filter((item) => item.evaluation?.status === "OPEN").length;
  const closeCount = sortedItems.filter((item) => item.evaluation?.status === "CLOSE").length;
  const depthIssueCount = sortedItems.filter((item) => item.evaluation && !item.evaluation.depthOk).length;
  const errorCount = sortedItems.filter((item) => item.error).length;

  return {
    generatedAt: new Date().toISOString(),
    notionalUsd: input.notionalUsd,
    requestedLimit: safeLimit,
    discoveredPairs: discoveredPairs.length,
    scannedPairs: sortedItems.length,
    openCount,
    closeCount,
    noOpportunityCount: sortedItems.length - openCount - closeCount - errorCount,
    depthIssueCount,
    errorCount,
    items: sortedItems
  };
}
