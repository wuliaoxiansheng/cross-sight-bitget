import type { BasisEvaluation } from "../types/market.js";

export type PaperTradePreview = {
  action: "OPEN" | "HOLD" | "CLOSE";
  pairId: string;
  spotSymbol: string;
  futuresSymbol: string;
  notionalUsd: number;
  baseQuantity: number;
  spotPrice: number;
  futuresPrice: number;
  estimatedFeeCost: number;
  estimatedFundingIncome: number;
  estimatedEdgeUsd: number;
  balanceAfter: number;
  notes: string;
  timestamp: string;
};

export function buildPaperTradePreview(evaluation: BasisEvaluation, startingBalance = 10_000): PaperTradePreview {
  const feeCost = evaluation.notionalUsd * evaluation.feeDrag;
  const estimatedFundingIncome = evaluation.notionalUsd * evaluation.expectedFundingEdge;
  const estimatedEdgeUsd = evaluation.notionalUsd * evaluation.expectedEdge;

  return {
    action: evaluation.status === "OPEN" ? "OPEN" : evaluation.status === "CLOSE" ? "CLOSE" : "HOLD",
    pairId: evaluation.pair.id,
    spotSymbol: evaluation.pair.spotSymbol,
    futuresSymbol: evaluation.pair.futuresSymbol,
    notionalUsd: evaluation.notionalUsd,
    baseQuantity: evaluation.baseQuantity,
    spotPrice: evaluation.status === "CLOSE" ? evaluation.spotSellVwap : evaluation.spotBuyVwap,
    futuresPrice: evaluation.status === "CLOSE" ? evaluation.futuresCoverVwap : evaluation.futuresShortVwap,
    estimatedFeeCost: feeCost,
    estimatedFundingIncome,
    estimatedEdgeUsd,
    balanceAfter: startingBalance + estimatedEdgeUsd - feeCost,
    notes: evaluation.narratorText,
    timestamp: evaluation.timestamp
  };
}

