export type SignalStatus = "OPEN" | "HOLD" | "CLOSE" | "WAIT";

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

const now = new Date().toISOString();

const sampleScan: OpportunityScan = {
  generatedAt: now,
  notionalUsd: 5000,
  requestedLimit: 12,
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

export async function getLiveScan(): Promise<OpportunityScan> {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

  try {
    const response = await fetch(`${apiBaseUrl}/opportunities/live-all?limit=12&notionalUsd=5000`, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`API responded with ${response.status}`);
    }

    const payload = (await response.json()) as { data: OpportunityScan };
    return payload.data;
  } catch {
    return sampleScan;
  }
}

export function statusLabel(item: OpportunityScanItem): string {
  if (item.error) return "接口异常";
  if (!item.evaluation) return "接口异常";
  if (!item.evaluation.depthOk) return "深度不足";
  if (item.evaluation.status === "OPEN") return "有机会";
  if (item.evaluation.status === "CLOSE") return "适合平仓";
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

