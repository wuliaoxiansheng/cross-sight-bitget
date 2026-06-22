import type { AgentAnalysis, BasisEvaluation } from "../types/market.js";

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
    const historyText = evaluation.fundingContext.recentNonZeroRate != null
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

export function buildAgentAnalysis(evaluation: BasisEvaluation): AgentAnalysis {
  const fundingHistory =
    evaluation.fundingContext.recentNonZeroRate != null
      ? `最近非零费率 ${pct(evaluation.fundingContext.recentNonZeroRate, 4)}，年化约 ${pct(
          evaluation.fundingContext.recentNonZeroApr ?? 0
        )}`
      : "最近 10 期没有非零费率";
  const riskNotes: string[] = [];

  if (!evaluation.priceQualityOk && evaluation.priceQualityReason) {
    riskNotes.push(evaluation.priceQualityReason);
  }

  if (!evaluation.depthOk) {
    riskNotes.push("订单簿深度不足，当前监控金额下不适合直接按纸面价差执行。");
  }

  if (evaluation.marketSession.isLikelyInactive) {
    riskNotes.push(evaluation.marketSession.description);
  }

  if (evaluation.fundingRate === 0) {
    riskNotes.push("当前资金费率为 0，不能为了吃费率新开仓，只能作为已有仓位退出或周末缺口观察信号。");
  } else if (evaluation.fundingRate < 0) {
    riskNotes.push("当前资金费率为负，做空合约不再收钱，继续持有会反向付费。");
  }

  if (evaluation.expectedEdge < 0) {
    riskNotes.push("扣除现货和合约手续费后，新增开仓 edge 为负。");
  }

  const signalSummary =
    evaluation.status === "OPEN"
      ? "深度、正基差和正资金费率同时满足，属于可重点检查的开仓候选。"
      : evaluation.status === "HOLD"
        ? "有正基差和正资金费率，但扣费后 edge 不够，不适合追新仓。"
        : evaluation.status === "CLOSE"
          ? "更像已有仓位的退出检查窗口，不是新增开仓信号。"
          : "当前没有可执行套利信号。";

  const suggestedAction =
    evaluation.status === "OPEN"
      ? "先小额复核订单簿深度和下次结算时间，再考虑 paper trade 记录。"
      : evaluation.status === "CLOSE"
        ? "如果已经买入 RToken 并做空合约，检查退出基差和手续费后是否平仓；没有仓位则继续观察。"
        : evaluation.status === "HOLD"
          ? "保留在观察列表，等待费率或基差扩大。"
          : "不新开仓，等待下一轮扫描或降低名义金额重新评估。";

  return {
    signalSummary,
    fundingSummary: `当前资金费率 ${pct(evaluation.fundingRate, 4)}，年化 ${pct(
      evaluation.fundingApr
    )}；${fundingHistory}。`,
    basisSummary: `开仓基差 ${pct(evaluation.entryBasis)}，退出基差 ${pct(
      evaluation.closeBasis
    )}，扣费后 edge ${pct(evaluation.expectedEdge)}。`,
    riskNotes: riskNotes.length > 0 ? riskNotes : ["当前没有额外风险标记，仍需按真实盘口复核。"],
    suggestedAction
  };
}
