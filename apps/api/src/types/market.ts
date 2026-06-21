export type MarketPairConfig = {
  id: string;
  name: string;
  spotSymbol: string;
  futuresSymbol: string;
  productType: "USDT-FUTURES" | string;
  spotFeeRate: number;
  futuresFeeRate: number;
  maxNotionalUsd: number;
  enabled: boolean;
};

export type SpotSymbolConfig = {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  status: string;
  takerFeeRate: number;
  makerFeeRate: number;
  minTradeUsdt: number;
};

export type OrderBookLevel = {
  price: number;
  size: number;
};

export type OrderBook = {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: number;
};

export type SpotTicker = {
  symbol: string;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  bidSize: number;
  askSize: number;
  quoteVolume: number;
  timestamp: number;
};

export type FuturesTicker = {
  symbol: string;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  bidSize: number;
  askSize: number;
  markPrice: number;
  indexPrice: number;
  fundingRate: number;
  openInterest: number;
  quoteVolume: number;
  timestamp: number;
};

export type FundingRate = {
  symbol: string;
  fundingRate: number;
  fundingIntervalHours: number;
  nextUpdate: number;
  minFundingRate: number;
  maxFundingRate: number;
};

export type HistoricalFundingRate = {
  symbol: string;
  fundingRate: number;
  fundingTime: number;
};

export type FundingContext = {
  currentRate: number;
  intervalHours: number;
  currentApr: number;
  recentNonZeroRate: number | null;
  recentNonZeroApr: number | null;
  recentNonZeroTime: number | null;
  recentMaxRate: number | null;
  recentMinRate: number | null;
  recentMaxApr: number | null;
  recentMinApr: number | null;
  recentWindowCount: number;
  state: "active_positive" | "active_negative" | "zero_with_history" | "zero";
};

export type MarketSessionContext = {
  state: "regular" | "extended" | "weekend_closed" | "holiday_closed" | "overnight_closed";
  label: string;
  description: string;
  isLikelyInactive: boolean;
  newYorkDate: string;
  newYorkTime: string;
};

export type AgentAnalysis = {
  signalSummary: string;
  fundingSummary: string;
  basisSummary: string;
  riskNotes: string[];
  suggestedAction: string;
};

export type OpportunityStatus = "OPEN" | "HOLD" | "CLOSE" | "WAIT";

export type DiscoveredRTokenPair = {
  pair: MarketPairConfig;
  spotTicker: SpotTicker;
  futuresTicker: FuturesTicker;
  spotVolumeUsd: number;
};

export type BasisEvaluation = {
  pair: MarketPairConfig;
  status: OpportunityStatus;
  notionalUsd: number;
  baseQuantity: number;
  spotBuyVwap: number;
  futuresShortVwap: number;
  spotSellVwap: number;
  futuresCoverVwap: number;
  entryBasis: number;
  closeBasis: number;
  feeDrag: number;
  expectedFundingEdge: number;
  expectedEdge: number;
  fundingRate: number;
  fundingApr: number;
  fundingContext: FundingContext;
  marketSession: MarketSessionContext;
  analysis: AgentAnalysis;
  nextFundingTime: number;
  depthOk: boolean;
  reason: string;
  narratorText: string;
  timestamp: string;
};

export type OpportunityScanItem = {
  pair: MarketPairConfig;
  spotVolumeUsd: number;
  evaluation: BasisEvaluation | null;
  error: string | null;
};

export type OpportunityScan = {
  generatedAt: string;
  notionalUsd: number;
  requestedLimit: number | null;
  discoveredPairs: number;
  scannedPairs: number;
  openCount: number;
  closeCount: number;
  noOpportunityCount: number;
  depthIssueCount: number;
  errorCount: number;
  items: OpportunityScanItem[];
};

export type OpportunitySnapshot = {
  status: "warming" | "scanning" | "ready" | "stale" | "error";
  latestScan: OpportunityScan | null;
  scanning: boolean;
  startedAt: string | null;
  completedAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  intervalMs: number;
  limit: number | null;
};
