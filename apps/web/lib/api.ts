export type SignalStatus = "OPEN" | "HOLD" | "CLOSE" | "WAIT";

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

export type BasisEvaluation = {
  pair: {
    id: string;
    name: string;
    spotSymbol: string;
    futuresSymbol: string;
  };
  status: SignalStatus;
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
  nextFundingTime: number;
  depthOk: boolean;
  reason: string;
  narratorText: string;
  timestamp: string;
};

export type OpportunityScanItem = {
  pair: BasisEvaluation["pair"];
  spotVolumeUsd: number;
  evaluation: BasisEvaluation | null;
  error: string | null;
};

export type OpportunityScan = {
  generatedAt: string;
  notionalUsd: number;
  requestedLimit: number;
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
  limit: number;
};

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

const now = new Date().toISOString();

export const sampleScan: OpportunityScan = {
  generatedAt: now,
  notionalUsd: 5000,
  requestedLimit: 100,
  discoveredPairs: 6,
  scannedPairs: 6,
  openCount: 1,
  closeCount: 1,
  noOpportunityCount: 4,
  depthIssueCount: 2,
  errorCount: 0,
  items: [
    {
      pair: {
        id: "rspcxusdt_spcxusdt",
        name: "rSPCX spot / SPCXUSDT perpetual",
        spotSymbol: "RSPCXUSDT",
        futuresSymbol: "SPCXUSDT"
      },
      spotVolumeUsd: 3_980_000,
      evaluation: {
        pair: {
          id: "rspcxusdt_spcxusdt",
          name: "rSPCX spot / SPCXUSDT perpetual",
          spotSymbol: "RSPCXUSDT",
          futuresSymbol: "SPCXUSDT"
        },
        status: "OPEN",
        notionalUsd: 5000,
        baseQuantity: 27.84,
        spotBuyVwap: 179.63,
        futuresShortVwap: 181.43,
        spotSellVwap: 179.2,
        futuresCoverVwap: 181.55,
        entryBasis: 0.0100,
        closeBasis: -0.013,
        feeDrag: 0.0016,
        expectedFundingEdge: 0.00023,
        expectedEdge: 0.00863,
        fundingRate: 0.00023,
        fundingApr: 0.252,
        fundingContext: {
          currentRate: 0.00023,
          intervalHours: 8,
          currentApr: 0.252,
          recentNonZeroRate: 0.00023,
          recentNonZeroApr: 0.252,
          recentNonZeroTime: Date.now() - 8 * 60 * 60 * 1000,
          recentMaxRate: 0.00023,
          recentMinRate: 0,
          recentMaxApr: 0.252,
          recentMinApr: 0,
          recentWindowCount: 10,
          state: "active_positive"
        },
        nextFundingTime: Date.now() + 60 * 60 * 1000,
        depthOk: true,
        reason: "合约相对 RToken 现货存在溢价，且资金费率为正，扣除手续费后仍达到开仓阈值。",
        narratorText: "RSPCXUSDT / SPCXUSDT 出现费率基差机会：买现货并空合约仍有正 edge。",
        timestamp: now
      },
      error: null
    },
    {
      pair: {
        id: "rqqqusdt_qqqusdt",
        name: "rQQQ spot / QQQUSDT perpetual",
        spotSymbol: "RQQQUSDT",
        futuresSymbol: "QQQUSDT"
      },
      spotVolumeUsd: 1_607_361_209,
      evaluation: {
        pair: {
          id: "rqqqusdt_qqqusdt",
          name: "rQQQ spot / QQQUSDT perpetual",
          spotSymbol: "RQQQUSDT",
          futuresSymbol: "QQQUSDT"
        },
        status: "WAIT",
        notionalUsd: 5000,
        baseQuantity: 6.75,
        spotBuyVwap: 739.92,
        futuresShortVwap: 739.1,
        spotSellVwap: 739.68,
        futuresCoverVwap: 739.3,
        entryBasis: -0.0011,
        closeBasis: 0.0005,
        feeDrag: 0.0016,
        expectedFundingEdge: 0,
        expectedEdge: -0.0027,
        fundingRate: 0,
        fundingApr: 0,
        fundingContext: {
          currentRate: 0,
          intervalHours: 8,
          currentApr: 0,
          recentNonZeroRate: 0.000009,
          recentNonZeroApr: 0.009855,
          recentNonZeroTime: Date.now() - 24 * 60 * 60 * 1000,
          recentMaxRate: 0.000009,
          recentMinRate: 0,
          recentMaxApr: 0.009855,
          recentMinApr: 0,
          recentWindowCount: 10,
          state: "zero_with_history"
        },
        nextFundingTime: Date.now() + 60 * 60 * 1000,
        depthOk: false,
        reason: "订单簿深度不足，当前名义金额无法完整成交。",
        narratorText: "RQQQUSDT / QQQUSDT 暂无可执行套利信号。",
        timestamp: now
      },
      error: null
    }
  ]
};

export async function getOpportunitySnapshot(): Promise<OpportunitySnapshot> {
  try {
    const response = await fetch(`${API_BASE_URL}/opportunities/snapshot`, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`API responded with ${response.status}`);
    }

    const payload = (await response.json()) as { data: OpportunitySnapshot };
    return payload.data;
  } catch {
    return {
      status: "ready",
      latestScan: sampleScan,
      scanning: false,
      startedAt: null,
      completedAt: sampleScan.generatedAt,
      nextRunAt: null,
      lastError: "API unavailable, showing local sample data.",
      intervalMs: 30_000,
      limit: 100
    };
  }
}

export function statusLabel(item: OpportunityScanItem): string {
  if (item.error) return "接口异常";
  if (!item.evaluation) return "接口异常";
  if (!item.evaluation.depthOk) return "深度不足";
  if (item.evaluation.status === "OPEN") return "有机会";
  if (item.evaluation.status === "CLOSE") return item.evaluation.fundingRate === 0 ? "费率归零" : "适合平仓";
  return "无机会";
}

export function statusTone(item: OpportunityScanItem): "good" | "bad" | "warn" | "muted" {
  if (item.error || !item.evaluation) return "bad";
  if (!item.evaluation.depthOk) return "warn";
  if (item.evaluation.status === "OPEN") return "good";
  if (item.evaluation.status === "CLOSE") return "bad";
  return "muted";
}

export function formatPercent(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatUsd(value: number, compact = false): string {
  if (!Number.isFinite(value)) return "n/a";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: compact ? 1 : 2,
    notation: compact ? "compact" : "standard"
  });
}
