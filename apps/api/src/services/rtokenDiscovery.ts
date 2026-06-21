import type { DiscoveredRTokenPair, FuturesTicker, MarketPairConfig, SpotTicker } from "../types/market.js";
import { BitgetClient } from "./bitgetClient.js";

const FUTURES_FEE_RATE = 0.0006;
const MAX_NOTIONAL_USD = 10_000;
const MIN_PRICE_RATIO = 0.5;
const MAX_PRICE_RATIO = 2;

type DiscoveryOptions = {
  limit?: number | null;
  pinnedPairs?: MarketPairConfig[];
};

function toPairId(spotSymbol: string, futuresSymbol: string): string {
  return `${spotSymbol}_${futuresSymbol}`.toLowerCase();
}

function makePairConfig(input: {
  baseCoin: string;
  spotSymbol: string;
  futuresSymbol: string;
  takerFeeRate: number;
}): MarketPairConfig {
  return {
    id: toPairId(input.spotSymbol, input.futuresSymbol),
    name: `${input.baseCoin} spot / ${input.futuresSymbol} perpetual`,
    spotSymbol: input.spotSymbol,
    futuresSymbol: input.futuresSymbol,
    productType: "USDT-FUTURES",
    spotFeeRate: input.takerFeeRate || 0.001,
    futuresFeeRate: FUTURES_FEE_RATE,
    maxNotionalUsd: MAX_NOTIONAL_USD,
    enabled: true
  };
}

function pairKey(pair: Pick<MarketPairConfig, "spotSymbol" | "futuresSymbol">): string {
  return `${pair.spotSymbol}:${pair.futuresSymbol}`;
}

function hydratePinnedPair(
  pair: MarketPairConfig,
  spotTickerBySymbol: Map<string, SpotTicker>,
  futuresTickerBySymbol: Map<string, FuturesTicker>
): DiscoveredRTokenPair | null {
  const spotTicker = spotTickerBySymbol.get(pair.spotSymbol);
  const futuresTicker = futuresTickerBySymbol.get(pair.futuresSymbol);

  if (!spotTicker || !futuresTicker) return null;

  return {
    pair,
    spotTicker,
    futuresTicker,
    spotVolumeUsd: spotTicker.quoteVolume
  };
}

// RToken discovery is intentionally strict:
// rSPCX spot maps to SPCXUSDT perp, rQQQ maps to QQQUSDT, etc.
// We do not fuzzy match product names because similarly named locked/Earn
// products can exist on Bitget and should never be included in this monitor.
export async function discoverRTokenPairs(
  bitget: BitgetClient,
  options: DiscoveryOptions = {}
): Promise<DiscoveredRTokenPair[]> {
  const safeLimit = options.limit == null ? null : Math.max(1, options.limit);
  const [symbols, spotTickers, futuresTickers] = await Promise.all([
    bitget.getSpotSymbols(),
    bitget.getSpotTickers(),
    bitget.getFuturesTickers("USDT-FUTURES")
  ]);

  const spotTickerBySymbol = new Map<string, SpotTicker>(spotTickers.map((ticker) => [ticker.symbol, ticker]));
  const futuresTickerBySymbol = new Map<string, FuturesTicker>(
    futuresTickers.map((ticker) => [ticker.symbol, ticker])
  );

  const pinnedPairs = (options.pinnedPairs ?? [])
    .filter((pair) => pair.enabled)
    .map((pair) => hydratePinnedPair(pair, spotTickerBySymbol, futuresTickerBySymbol))
    .filter((pair): pair is DiscoveredRTokenPair => Boolean(pair));

  const pinnedKeys = new Set(pinnedPairs.map((item) => pairKey(item.pair)));
  const autoPairs = symbols
    .filter((symbol) => {
      return (
        symbol.status === "online" &&
        symbol.quoteCoin === "USDT" &&
        /^r[A-Za-z0-9]+$/.test(symbol.baseCoin) &&
        symbol.symbol.endsWith("USDT")
      );
    })
    .map((symbol): DiscoveredRTokenPair | null => {
      const underlying = symbol.baseCoin.slice(1).toUpperCase();
      const futuresSymbol = `${underlying}USDT`;
      const spotTicker = spotTickerBySymbol.get(symbol.symbol);
      const futuresTicker = futuresTickerBySymbol.get(futuresSymbol);

      if (!spotTicker || !futuresTicker) return null;

      const priceRatio = spotTicker.lastPrice / futuresTicker.lastPrice;
      if (!Number.isFinite(priceRatio) || priceRatio < MIN_PRICE_RATIO || priceRatio > MAX_PRICE_RATIO) {
        return null;
      }

      return {
        pair: makePairConfig({
          baseCoin: symbol.baseCoin,
          spotSymbol: symbol.symbol,
          futuresSymbol,
          takerFeeRate: symbol.takerFeeRate
        }),
        spotTicker,
        futuresTicker,
        spotVolumeUsd: spotTicker.quoteVolume
      };
    })
    .filter((pair): pair is DiscoveredRTokenPair => Boolean(pair))
    .filter((item) => !pinnedKeys.has(pairKey(item.pair)))
    .sort((a, b) => b.spotVolumeUsd - a.spotVolumeUsd);

  if (safeLimit == null) {
    return [...pinnedPairs, ...autoPairs];
  }

  return [...pinnedPairs, ...autoPairs.slice(0, Math.max(0, safeLimit - pinnedPairs.length))];
}
