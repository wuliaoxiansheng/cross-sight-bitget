import { WATCHLIST } from "../data/pairs.js";
import type { FundingRate, OpportunityScan, OpportunityScanItem } from "../types/market.js";
import { evaluateBasisOpportunity } from "./basisEngine.js";
import { BitgetClient } from "./bitgetClient.js";
import { discoverRTokenPairs } from "./rtokenDiscovery.js";

const SCAN_CONCURRENCY = 10;
const WATCHLIST_KEYS = new Set(WATCHLIST.map((pair) => `${pair.spotSymbol}:${pair.futuresSymbol}`));

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
  const kindRank = {
    executable: 0,
    watch_small_size: 1,
    watch_funding_return: 2,
    watch_near_edge: 3,
    exit_check: 4,
    none: 5,
    data_risk: 6,
    ERROR: 7
  };

  const aKind = a.evaluation?.opportunityKind ?? "ERROR";
  const bKind = b.evaluation?.opportunityKind ?? "ERROR";
  const rankDiff = kindRank[aKind] - kindRank[bKind];
  if (rankDiff !== 0) return rankDiff;

  const scoreDiff = (b.evaluation?.opportunityScore ?? -999) - (a.evaluation?.opportunityScore ?? -999);
  if (scoreDiff !== 0) return scoreDiff;

  const aPinned = WATCHLIST_KEYS.has(`${a.pair.spotSymbol}:${a.pair.futuresSymbol}`);
  const bPinned = WATCHLIST_KEYS.has(`${b.pair.spotSymbol}:${b.pair.futuresSymbol}`);
  if (aPinned !== bPinned) return aPinned ? -1 : 1;

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
  limit?: number | null;
  notionalUsd: number;
}): Promise<OpportunityScan> {
  const safeLimit = input.limit == null ? null : Math.max(1, input.limit);
  const discoveredPairs = await discoverRTokenPairs(input.bitget, {
    limit: safeLimit,
    pinnedPairs: WATCHLIST
  });

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
  const candidateCount = sortedItems.filter((item) =>
    ["watch_small_size", "watch_funding_return", "watch_near_edge"].includes(item.evaluation?.opportunityKind ?? "")
  ).length;
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
    candidateCount,
    closeCount,
    noOpportunityCount: sortedItems.length - openCount - closeCount - errorCount,
    depthIssueCount,
    errorCount,
    items: sortedItems
  };
}
