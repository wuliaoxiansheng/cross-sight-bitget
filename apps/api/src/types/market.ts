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

export type OpportunityStatus = "OPEN" | "HOLD" | "CLOSE" | "WAIT";

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
  nextFundingTime: number;
  depthOk: boolean;
  reason: string;
  narratorText: string;
  timestamp: string;
};

