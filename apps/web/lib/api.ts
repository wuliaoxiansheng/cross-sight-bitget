export type BasisEvaluation = {
  pair: {
    id: string;
    name: string;
    spotSymbol: string;
    futuresSymbol: string;
  };
  status: "OPEN" | "HOLD" | "CLOSE" | "WAIT";
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

const sampleEvaluation: BasisEvaluation = {
  pair: {
    id: "rspcx_spcx_perp",
    name: "rSPCX spot / SPCX USDT perpetual",
    spotSymbol: "RSPCXUSDT",
    futuresSymbol: "SPCXUSDT"
  },
  status: "CLOSE",
  notionalUsd: 5000,
  baseQuantity: 27.24,
  spotBuyVwap: 183.42,
  futuresShortVwap: 181.58,
  spotSellVwap: 183.12,
  futuresCoverVwap: 181.64,
  entryBasis: -0.0101,
  closeBasis: 0.0081,
  feeDrag: 0.0016,
  expectedFundingEdge: 0,
  expectedEdge: -0.0117,
  fundingRate: 0,
  fundingApr: 0,
  nextFundingTime: Date.now() + 60 * 60 * 1000,
  depthOk: true,
  reason: "资金费率归零/转负，或现货退出价格已经优于合约回补价格，适合检查已有仓位是否平掉。",
  narratorText:
    "RSPCXUSDT / SPCXUSDT 更像平仓窗口：当前资金费率为 0.0000%，退出基差约 0.81%。如果此前已经买现货并空合约，应优先检查是否锁定利润。",
  timestamp: new Date().toISOString()
};

export async function getLiveEvaluation(): Promise<BasisEvaluation> {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

  try {
    const response = await fetch(`${apiBaseUrl}/opportunities/live?pairId=rspcx_spcx_perp&notionalUsd=5000`, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`API responded with ${response.status}`);
    }

    const payload = (await response.json()) as { data: BasisEvaluation };
    return payload.data;
  } catch {
    // The page remains useful before the API is running. The fallback mirrors
    // the real payload shape so UI work and demo recording can continue.
    return sampleEvaluation;
  }
}

export function formatPercent(value: number, digits = 2): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  });
}

