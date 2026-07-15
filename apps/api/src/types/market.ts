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

export type FuturesContractConfig = {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  status: string;
  symbolType: string;
  isRwa: boolean;
  takerFeeRate: number;
  makerFeeRate: number;
  fundingIntervalHours: number;
  maxLeverage: number;
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

export type PriceCandle = {
  timestamp: number;
  close: number;
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

export type OpportunityKind =
  | "executable"
  | "basis_convergence"
  | "watch_small_size"
  | "watch_funding_return"
  | "watch_near_edge"
  | "exit_check"
  | "data_risk"
  | "none";

export type ExecutionStrategy = "funding_basis" | "basis_convergence" | "none";

export type ExecutionBand = {
  notionalUsd: number;
  depthOk: boolean;
  baseQuantity: number;
  spotBuyVwap: number;
  futuresShortVwap: number;
  spotSellVwap: number;
  futuresCoverVwap: number;
  entryBasis: number;
  closeBasis: number;
  basisEdge: number;
  expectedFundingEdge: number;
  expectedEdge: number;
  strategy: ExecutionStrategy;
  negativeFundingBreakEvenPeriods: number | null;
};

export type DiscoveredRTokenPair = {
  pair: MarketPairConfig;
  spotTicker: SpotTicker;
  futuresTicker: FuturesTicker;
  spotVolumeUsd: number;
};

export type BasisEvaluation = {
  pair: MarketPairConfig;
  status: OpportunityStatus;
  opportunityKind: OpportunityKind;
  opportunityLabel: string;
  opportunityScore: number;
  opportunityNotes: string[];
  notionalUsd: number;
  baseQuantity: number;
  spotBuyVwap: number;
  futuresShortVwap: number;
  spotSellVwap: number;
  futuresCoverVwap: number;
  entryBasis: number;
  closeBasis: number;
  feeDrag: number;
  basisEdge: number;
  expectedFundingEdge: number;
  expectedEdge: number;
  strategy: ExecutionStrategy;
  negativeFundingBreakEvenPeriods: number | null;
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
  priceQualityOk: boolean;
  priceQualityReason: string | null;
  executionBands: ExecutionBand[];
  bestExecutableBand: ExecutionBand | null;
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
  basisOpportunityCount: number;
  fundingOpportunityCount: number;
  candidateCount: number;
  closeCount: number;
  noOpportunityCount: number;
  depthIssueCount: number;
  errorCount: number;
  items: OpportunityScanItem[];
};

export type CrossVenueName = "bitget" | "hyperliquid_xyz";

export type CrossVenueDirection =
  | "LONG_HYPERLIQUID_SHORT_BITGET"
  | "LONG_BITGET_SHORT_HYPERLIQUID";

export type CrossVenueOpportunityKind =
  | "spread_convergence"
  | "snapshot_basis"
  | "funding_carry"
  | "none";

export type SpreadHistorySample = {
  timestamp: number;
  signedSpread: number;
};

export type SpreadConvergenceContext = {
  historicalReady: boolean;
  sampleCount: number;
  windowHours: number;
  currentSignedSpread: number;
  medianSignedSpread: number;
  deviationFromMedian: number;
  robustSigma: number;
  zScore: number;
  absoluteDeviationPercentile: number;
  halfLifeHours: number | null;
  historicalConvergenceRate: number | null;
  historicalConvergenceObservations: number;
  isAbnormal: boolean;
};

export type HyperliquidPerpMarket = {
  coin: string;
  ticker: string;
  maxLeverage: number;
  onlyIsolated: boolean;
  isDelisted: boolean;
  markPrice: number;
  midPrice: number;
  oraclePrice: number;
  fundingRate: number;
  fundingIntervalHours: number;
  openInterest: number;
  quoteVolume: number;
};

export type CrossVenuePair = {
  id: string;
  ticker: string;
  bitgetSymbol: string;
  bitgetProductType: string;
  hyperliquidCoin: string;
  bitgetTakerFeeRate: number;
  hyperliquidTakerFeeRate: number;
  bitgetFundingIntervalHours: number;
  hyperliquidFundingIntervalHours: number;
  maxNotionalUsd: number;
};

export type CrossVenueExecutionBand = {
  notionalUsd: number;
  depthOk: boolean;
  direction: CrossVenueDirection;
  longVenue: CrossVenueName;
  shortVenue: CrossVenueName;
  baseQuantity: number;
  longEntryVwap: number;
  shortEntryVwap: number;
  longExitVwap: number;
  shortExitVwap: number;
  entryBasis: number;
  closeBasis: number;
  feeDrag: number;
  expectedFundingEdge: number;
  snapshotExpectedEdge: number;
  targetDirectionalBasis: number;
  convergenceGrossEdge: number;
  convergenceExpectedEdge: number;
  expectedEdge: number;
  opportunityKind: CrossVenueOpportunityKind;
};

export type CrossVenueEvaluation = {
  pair: CrossVenuePair;
  status: "OPEN" | "WATCH" | "WAIT";
  opportunityLabel: string;
  opportunityKind: CrossVenueOpportunityKind;
  opportunityScore: number;
  direction: CrossVenueDirection;
  longVenue: CrossVenueName;
  shortVenue: CrossVenueName;
  notionalUsd: number;
  baseQuantity: number;
  longEntryVwap: number;
  shortEntryVwap: number;
  longExitVwap: number;
  shortExitVwap: number;
  entryBasis: number;
  closeBasis: number;
  feeDrag: number;
  expectedFundingEdge: number;
  snapshotExpectedEdge: number;
  targetDirectionalBasis: number;
  convergenceGrossEdge: number;
  convergenceExpectedEdge: number;
  expectedEdge: number;
  bitgetFundingRate: number;
  hyperliquidFundingRate: number;
  fundingHorizonHours: number;
  convergence: SpreadConvergenceContext;
  depthOk: boolean;
  reason: string;
  riskNotes: string[];
  timestamp: string;
  executionBands: CrossVenueExecutionBand[];
  bestExecutableBand: CrossVenueExecutionBand | null;
};

export type CrossVenueScanItem = {
  pair: CrossVenuePair;
  bitgetQuoteVolume: number;
  hyperliquidQuoteVolume: number;
  evaluation: CrossVenueEvaluation | null;
  error: string | null;
};

export type CrossVenueOpportunityScan = {
  generatedAt: string;
  notionalUsd: number;
  discoveredPairs: number;
  scannedPairs: number;
  openCount: number;
  watchCount: number;
  noOpportunityCount: number;
  depthIssueCount: number;
  errorCount: number;
  fundingHorizonHours: number;
  items: CrossVenueScanItem[];
};

export type OpportunitySnapshot = {
  status: "warming" | "scanning" | "ready" | "stale" | "error";
  latestScan: OpportunityScan | null;
  crossVenueScan: CrossVenueOpportunityScan | null;
  scanning: boolean;
  startedAt: string | null;
  completedAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  intervalMs: number;
  limit: number | null;
};
