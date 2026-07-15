import type { BasisEvaluation, OpportunityScan } from "../lib/api";
import { formatPercent, formatUsd } from "../lib/api";
import { SignalBadge } from "./SignalBadge";

function opportunityHint(evaluation: BasisEvaluation | null): { title: string; detail: string } {
  if (!evaluation) return { title: "n/a", detail: "" };

  if (evaluation.opportunityKind === "basis_convergence") {
    const fundingHeadroom = evaluation.negativeFundingBreakEvenPeriods != null
      ? ` · 负费率约可覆盖 ${evaluation.negativeFundingBreakEvenPeriods.toFixed(1)} 期`
      : "";
    return {
      title: evaluation.opportunityLabel,
      detail: `RToken 净基差 ${formatPercent(evaluation.basisEdge)}${fundingHeadroom}`
    };
  }

  if (evaluation.opportunityKind === "watch_small_size" && evaluation.bestExecutableBand) {
    return {
      title: evaluation.opportunityLabel,
      detail: `Edge ${formatPercent(evaluation.bestExecutableBand.expectedEdge)} · 基差 ${formatPercent(
        evaluation.bestExecutableBand.entryBasis
      )}`
    };
  }

  if (evaluation.opportunityKind === "watch_funding_return") {
    return {
      title: evaluation.opportunityLabel,
      detail: `当前费率 ${formatPercent(evaluation.fundingRate, 4)}`
    };
  }

  if (evaluation.opportunityKind === "watch_near_edge") {
    return {
      title: evaluation.opportunityLabel,
      detail: `阈值差 ${formatPercent(Math.max(0, 0.003 - evaluation.expectedEdge))}`
    };
  }

  return {
    title: evaluation.opportunityLabel,
    detail: evaluation.opportunityNotes[0] ?? evaluation.reason
  };
}

export function OpportunityTable({
  scan,
  selectedPairId,
  onSelectPair
}: {
  scan: OpportunityScan;
  selectedPairId: string | null;
  onSelectPair: (item: OpportunityScan["items"][number]) => void;
}) {
  return (
    <section className="panel scanner-panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">热门 RToken 扫描</div>
          <p className="panel-subtitle">点击任意标的，右侧 Agent 会重新拉取实时盘口、费率和基差。</p>
        </div>
        <div className="scan-time">
          {scan.items.length} 个结果 · {new Date(scan.generatedAt).toLocaleTimeString("zh-CN")}
        </div>
      </div>
      <div className="table-wrap">
        <table className="opportunity-table">
          <thead>
            <tr>
              <th>标的</th>
              <th>信号</th>
              <th>机会线索</th>
              <th>评分</th>
              <th>净 Edge</th>
              <th>开仓基差</th>
              <th>当前费率</th>
              <th>最近非零</th>
              <th>现货 / 合约 VWAP</th>
              <th>成交额</th>
            </tr>
          </thead>
          <tbody>
            {scan.items.map((item) => {
              const evaluation = item.evaluation;
              const hint = opportunityHint(evaluation);
              return (
                <tr
                  key={item.pair.id}
                  className={`${
                    evaluation?.opportunityKind === "executable" || evaluation?.opportunityKind === "basis_convergence"
                      ? "row-open"
                      : ""
                  } ${
                    evaluation?.opportunityKind?.startsWith("watch_") ? "row-candidate" : ""
                  } ${evaluation?.opportunityKind === "data_risk" ? "row-risk" : ""} ${
                    item.pair.id === selectedPairId ? "row-selected" : ""
                  }`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectPair(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectPair(item);
                    }
                  }}
                >
                  <td>
                    <div className="pair-name">{item.pair.spotSymbol}</div>
                    <div className="pair-sub">{item.pair.futuresSymbol}</div>
                  </td>
                  <td>
                    <SignalBadge item={item} />
                  </td>
                  <td>
                    <div className="opportunity-hint">{hint.title}</div>
                    <div className="pair-sub">{hint.detail}</div>
                  </td>
                  <td>{evaluation ? evaluation.opportunityScore.toFixed(1) : "n/a"}</td>
                  <td
                    className={
                      evaluation && evaluation.expectedEdge > 0
                        ? "positive"
                        : "muted"
                    }
                  >
                    {evaluation ? (
                      <div>
                        <div>{formatPercent(evaluation.expectedEdge)}</div>
                        <div className="pair-sub">RToken 基差 {formatPercent(evaluation.basisEdge)}</div>
                      </div>
                    ) : "n/a"}
                  </td>
                  <td>{evaluation ? formatPercent(evaluation.entryBasis) : "n/a"}</td>
                  <td>
                    {evaluation ? (
                      <div>
                        <div>{formatPercent(evaluation.fundingRate, 4)}</div>
                        <div className="pair-sub">APR {formatPercent(evaluation.fundingApr)}</div>
                      </div>
                    ) : (
                      "n/a"
                    )}
                  </td>
                  <td>
                    {evaluation?.fundingContext.recentNonZeroRate != null ? (
                      <div>
                        <div>{formatPercent(evaluation.fundingContext.recentNonZeroRate, 4)}</div>
                        <div className="pair-sub">APR {formatPercent(evaluation.fundingContext.recentNonZeroApr ?? 0)}</div>
                      </div>
                    ) : (
                      <span className="muted">近 10 期无</span>
                    )}
                  </td>
                  <td>
                    {evaluation ? (
                      <span>
                        {formatUsd(evaluation.spotBuyVwap)} / {formatUsd(evaluation.futuresShortVwap)}
                      </span>
                    ) : (
                      "n/a"
                    )}
                  </td>
                  <td>{formatUsd(item.spotVolumeUsd, true)}</td>
                </tr>
              );
            })}
            {scan.items.length === 0 ? (
              <tr>
                <td className="empty-cell" colSpan={10}>
                  没有匹配的 RToken 组合。换个关键词或筛选条件。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
