import type { BasisEvaluation } from "../types/market.js";

function pct(value: number, digits = 2): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function money(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  });
}

export function narrateBasisEvaluation(evaluation: BasisEvaluation): string {
  const pair = `${evaluation.pair.spotSymbol} / ${evaluation.pair.futuresSymbol}`;

  if (evaluation.status === "OPEN") {
    return `${pair} 出现费率基差机会：用 ${money(evaluation.notionalUsd)} 买入 RToken 现货、同步做空合约，VWAP 开仓基差约 ${pct(
      evaluation.entryBasis
    )}，资金费率年化约 ${pct(evaluation.fundingApr)}，扣除预估费用后的 edge 约 ${pct(evaluation.expectedEdge)}。`;
  }

  if (evaluation.status === "CLOSE") {
    const closeLead =
      evaluation.fundingRate === 0
        ? "当前费率已归零"
        : evaluation.fundingRate < 0
          ? "当前费率已转负"
          : "退出基差已经优于合约回补";
    const actionText =
      evaluation.fundingRate <= 0
        ? "不建议为了吃费率新开仓，已有仓位再检查是否退出。"
        : "如果此前已有基差仓位，应检查是否可以锁定退出收益。";
    const historyText = evaluation.fundingContext.recentNonZeroRate
      ? `最近一次非零费率为 ${pct(evaluation.fundingContext.recentNonZeroRate, 4)}，年化约 ${pct(
          evaluation.fundingContext.recentNonZeroApr ?? 0
        )}。`
      : "最近 10 期也没有非零费率。";

    return `${pair} ${closeLead}：当前资金费率为 ${pct(evaluation.fundingRate, 4)}，退出基差约 ${pct(
      evaluation.closeBasis
    )}。${historyText}${actionText}`;
  }

  if (evaluation.status === "HOLD") {
    return `${pair} 仍可观察：资金费率为正，合约相对现货仍有 ${pct(
      evaluation.entryBasis
    )} 的开仓基差，但扣费后的新增 edge 暂未达到开仓阈值。`;
  }

  return `${pair} 暂无可执行套利信号：当前深度、基差或资金费率不足以覆盖手续费和滑点。`;
}
