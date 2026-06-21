import type { MarketPairConfig } from "../types/market.js";

// The watchlist is intentionally explicit. SPCX has similarly named products,
// including locked/earn-like variants, so this service never auto-matches by text.
export const WATCHLIST: MarketPairConfig[] = [
  {
    id: "rspcx_spcx_perp",
    name: "rSPCX spot / SPCX USDT perpetual",
    spotSymbol: "RSPCXUSDT",
    futuresSymbol: "SPCXUSDT",
    productType: "USDT-FUTURES",
    spotFeeRate: 0.001,
    futuresFeeRate: 0.0006,
    maxNotionalUsd: 10000,
    enabled: true
  }
];

