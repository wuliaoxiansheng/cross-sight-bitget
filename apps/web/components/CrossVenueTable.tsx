import { ArrowDown, ArrowUp, CheckCircle2, Eye, XCircle } from "lucide-react";
import type { CrossVenueOpportunityScan, CrossVenueScanItem } from "../lib/api";
import { formatPercent, formatUsd } from "../lib/api";

function venueLabel(venue: "bitget" | "hyperliquid_xyz"): string {
  return venue === "bitget" ? "Bitget" : "Hyperliquid";
}

function opportunityKindLabel(item: CrossVenueScanItem): string {
  const kind = item.evaluation?.opportunityKind;
  if (kind === "spread_convergence") return "历史价差收敛";
  if (kind === "funding_carry") return "费率套利";
  if (kind === "snapshot_basis") return "瞬时价差";
  return item.evaluation?.convergence.historicalReady ? "暂无" : "历史学习中";
}

function CrossSignal({ item }: { item: CrossVenueScanItem }) {
  const status = item.evaluation?.status;
  if (item.error || !item.evaluation) {
    return <span className="signal-badge signal-bad"><XCircle size={14} /> 接口异常</span>;
  }
  if (status === "OPEN") {
    return <span className="signal-badge signal-good"><CheckCircle2 size={14} /> 有机会</span>;
  }
  if (status === "WATCH") {
    return <span className="signal-badge signal-warn"><Eye size={14} /> 候选</span>;
  }
  return <span className="signal-badge signal-muted"><XCircle size={14} /> 无机会</span>;
}

export function CrossVenueTable({
  scan,
  selectedPairId,
  onSelectPair
}: {
  scan: CrossVenueOpportunityScan;
  selectedPairId: string | null;
  onSelectPair: (item: CrossVenueScanItem) => void;
}) {
  return (
    <section className="panel scanner-panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">双合约跨市场扫描</div>
          <p className="panel-subtitle">自动发现瞬时价差、资金费率和相对历史中枢的异常偏离；价差收敛信号优先排序。</p>
        </div>
        <div className="scan-time">{scan.items.length} 个结果 · {new Date(scan.generatedAt).toLocaleTimeString("zh-CN")}</div>
      </div>
      <div className="table-wrap">
        <table className="opportunity-table cross-venue-table">
          <thead>
            <tr>
              <th>标的</th>
              <th>信号</th>
              <th>机会类型</th>
              <th>执行方向</th>
              <th>净 Edge</th>
              <th>收敛空间</th>
              <th>历史偏离</th>
              <th>成交基差</th>
              <th>{scan.fundingHorizonHours}h 费率差</th>
              <th>最佳金额</th>
              <th>双边成交额</th>
            </tr>
          </thead>
          <tbody>
            {scan.items.map((item) => {
              const evaluation = item.evaluation;
              return (
                <tr
                  key={item.pair.id}
                  className={`${evaluation?.status === "OPEN" ? "row-open" : ""} ${evaluation?.status === "WATCH" ? "row-candidate" : ""} ${item.pair.id === selectedPairId ? "row-selected" : ""}`}
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
                    <div className="pair-name">{item.pair.ticker}</div>
                    <div className="pair-sub">{item.pair.bitgetSymbol} / {item.pair.hyperliquidCoin}</div>
                  </td>
                  <td><CrossSignal item={item} /></td>
                  <td>
                    <div className="opportunity-hint">{opportunityKindLabel(item)}</div>
                    <div className="pair-sub">{evaluation?.opportunityLabel ?? "n/a"}</div>
                  </td>
                  <td>
                    {evaluation ? (
                      <div className="direction-cell">
                        <span><ArrowUp size={13} /> 多 {venueLabel(evaluation.longVenue)}</span>
                        <span><ArrowDown size={13} /> 空 {venueLabel(evaluation.shortVenue)}</span>
                      </div>
                    ) : "n/a"}
                  </td>
                  <td className={evaluation && evaluation.expectedEdge > 0 ? "positive" : "muted"}>
                    {evaluation ? formatPercent(evaluation.expectedEdge) : "n/a"}
                  </td>
                  <td>{evaluation ? formatPercent(evaluation.convergenceGrossEdge) : "n/a"}</td>
                  <td>
                    {evaluation?.convergence.historicalReady ? (
                      <div>
                        <div>Z {evaluation.convergence.zScore.toFixed(2)}</div>
                        <div className="pair-sub">分位 {(evaluation.convergence.absoluteDeviationPercentile * 100).toFixed(0)}%</div>
                      </div>
                    ) : <span className="muted">{evaluation?.convergence.sampleCount ?? 0} 个样本</span>}
                  </td>
                  <td>{evaluation ? formatPercent(evaluation.entryBasis) : "n/a"}</td>
                  <td>{evaluation ? formatPercent(evaluation.expectedFundingEdge, 3) : "n/a"}</td>
                  <td>
                    {evaluation?.bestExecutableBand
                      ? `${formatUsd(evaluation.bestExecutableBand.notionalUsd)} · ${formatPercent(evaluation.bestExecutableBand.expectedEdge)}`
                      : "暂无"}
                  </td>
                  <td>{formatUsd(item.bitgetQuoteVolume + item.hyperliquidQuoteVolume, true)}</td>
                </tr>
              );
            })}
            {scan.items.length === 0 ? (
              <tr><td className="empty-cell" colSpan={11}>没有匹配的同名永续合约。</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
