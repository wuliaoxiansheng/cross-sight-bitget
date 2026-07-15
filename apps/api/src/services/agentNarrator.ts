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

  if (evaluation.opportunityKind === "basis_convergence") {
    const fundingCost = evaluation.fundingRate < 0
      ? `当前负费率每期约 ${pct(Math.abs(evaluation.fundingRate), 4)}，跨市场净价差理论上可覆盖约 ${(
          evaluation.negativeFundingBreakEvenPeriods ?? 0
        ).toFixed(1)} 期。`
      : `当前资金费率为 ${pct(evaluation.fundingRate, 4)}。`;

    return `${pair} 出现跨市场价差收敛机会：同一标的在 RToken 现货市场买入 ${money(evaluation.notionalUsd)}，并在 BG 合约市场同步做空等数量合约。VWAP 开仓基差约 ${pct(
      evaluation.entryBasis
    )}，扣除四腿手续费后的跨市场净价差约 ${pct(evaluation.basisEdge)}，计入预估费率后 Edge 约 ${pct(
      evaluation.expectedEdge
    )}。${fundingCost}`;
  }

  if (evaluation.status === "OPEN") {
    return `${pair} 出现费率基差机会：用 ${money(evaluation.notionalUsd)} 买入 RToken 现货、同步做空合约，VWAP 开仓基差约 ${pct(
      evaluation.entryBasis
    )}，资金费率年化约 ${pct(evaluation.fundingApr)}，扣除预估费用后的 edge 约 ${pct(evaluation.expectedEdge)}。`;
  }

  if (evaluation.opportunityKind === "watch_small_size" && evaluation.bestExecutableBand) {
    return `${pair} 大额不够好，但小额档位值得盯：${money(
      evaluation.bestExecutableBand.notionalUsd
    )} 档位 edge 约 ${pct(evaluation.bestExecutableBand.expectedEdge)}，开仓基差约 ${pct(
      evaluation.bestExecutableBand.entryBasis
    )}。`;
  }

  if (evaluation.opportunityKind === "watch_funding_return") {
    return `${pair} 当前不能新开仓，但历史费率值得盯：当前费率为 ${pct(
      evaluation.fundingRate,
      4
    )}，最近非零年化约 ${pct(evaluation.fundingContext.recentNonZeroApr ?? 0)}。等费率恢复后再复核基差和深度。`;
  }

  if (evaluation.opportunityKind === "watch_near_edge") {
    return `${pair} 接近机会区：当前开仓基差约 ${pct(evaluation.entryBasis)}，扣费后 edge 约 ${pct(
      evaluation.expectedEdge
    )}，还没达到开仓阈值。`;
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

  if (evaluation.opportunityKind === "basis_convergence") {
    riskNotes.push("这类信号赚的是两个市场对同一标的的价差收敛，不是正资金费率；价差可能继续扩大，必须控制保证金和持有时间。");
    if (evaluation.fundingRate < 0) {
      riskNotes.push(
        `BG 合约空头当前需要支付资金费率；按当前费率静态估算，跨市场净价差约可覆盖 ${(
          evaluation.negativeFundingBreakEvenPeriods ?? 0
        ).toFixed(1)} 期，实际费率会变化。`
      );
    }
  } else if (evaluation.fundingRate === 0) {
    riskNotes.push("当前资金费率为 0，不能为了吃费率新开仓，只能作为已有仓位退出或周末缺口观察信号。");
  } else if (evaluation.fundingRate < 0) {
    riskNotes.push("当前资金费率为负，做空合约不再收钱，继续持有会反向付费。");
  }

  if (evaluation.expectedEdge < 0) {
    riskNotes.push("扣除现货和合约手续费后，新增开仓 edge 为负。");
  }

  for (const note of evaluation.opportunityNotes) {
    if (!riskNotes.includes(note)) {
      riskNotes.push(note);
    }
  }

  const signalSummary =
    evaluation.opportunityKind === "basis_convergence"
      ? "同一标的在 BG 合约市场的可成交价显著高于 RToken 现货市场，扣除四腿成本和预估费率后仍有收敛空间。"
      : evaluation.opportunityKind === "executable"
      ? "深度、正基差和正资金费率同时满足，属于可重点检查的开仓候选。"
      : evaluation.opportunityKind === "watch_small_size"
        ? "大额名义金额不满足，但小额档位可能有可执行空间。"
        : evaluation.opportunityKind === "watch_funding_return"
          ? "当前费率归零，但历史非零费率较高，适合放入等待费率恢复列表。"
          : evaluation.opportunityKind === "watch_near_edge"
            ? "正基差接近开仓阈值，适合继续盯下一轮盘口和费率。"
      : evaluation.status === "HOLD"
        ? "有正基差和正资金费率，但扣费后 edge 不够，不适合追新仓。"
        : evaluation.status === "CLOSE"
          ? "更像已有仓位的退出检查窗口，不是新增开仓信号。"
          : "当前没有可执行套利信号。";

  const suggestedAction =
    evaluation.opportunityKind === "basis_convergence"
      ? "先按最佳可执行档在 RToken 市场买入，并在 BG 合约市场做空等数量合约；不要裸露单腿，并设置负费率和价差继续扩大的退出上限。"
      : evaluation.opportunityKind === "executable"
      ? "先小额复核订单簿深度和下次结算时间，再考虑 paper trade 记录。"
      : evaluation.opportunityKind === "watch_small_size"
        ? "切到更小名义金额实时复核；只在盘口、费率和成交深度同时成立时才考虑。"
        : evaluation.opportunityKind === "watch_funding_return"
          ? "加入候选列表，等下一轮资金费率恢复为正且基差仍覆盖费用时再检查。"
          : evaluation.opportunityKind === "watch_near_edge"
            ? "继续观察，不要抢跑；等待 edge 穿过开仓阈值。"
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
    basisSummary: `跨市场开仓基差 ${pct(evaluation.entryBasis)}，扣费后的跨市场净价差 ${pct(
      evaluation.basisEdge
    )}，退出基差 ${pct(
      evaluation.closeBasis
    )}，扣费后 edge ${pct(evaluation.expectedEdge)}。`,
    riskNotes: riskNotes.length > 0 ? riskNotes : ["当前没有额外风险标记，仍需按真实盘口复核。"],
    suggestedAction
  };
}
