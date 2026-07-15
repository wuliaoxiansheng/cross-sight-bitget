import { ArrowDown, ArrowUp, CheckCircle2, Eye, XCircle } from "lucide-react";
import type { CrossVenueOpportunityScan, CrossVenueScanItem } from "../lib/api";
import { formatPercent, formatUsd } from "../lib/api";

function venueLabel(venue: "bitget" | "hyperliquid_xyz"): string {
  return venue === "bitget" ? "Bitget" : "Hyperliquid";
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
          <p className="panel-subtitle">Bitget RWA 永续 ↔ Hyperliquid xyz 永续；自动计算两个做多/做空方向。</p>
        </div>
        <div className="scan-time">{scan.items.length} 个结果 · {new Date(scan.generatedAt).toLocaleTimeString("zh-CN")}</div>
      </div>
      <div className="table-wrap">
        <table className="opportunity-table cross-venue-table">
          <thead>
            <tr>
              <th>标的</th>
              <th>信号</th>
              <th>执行方向</th>
              <th>净 Edge</th>
              <th>成交基差</th>
              <th>{scan.fundingHorizonHours}h 费率差</th>
              <th>多 / 空 VWAP</th>
              <th>往返费用</th>
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
                  <td>{evaluation ? formatPercent(evaluation.entryBasis) : "n/a"}</td>
                  <td>{evaluation ? formatPercent(evaluation.expectedFundingEdge, 3) : "n/a"}</td>
                  <td>{evaluation ? `${formatUsd(evaluation.longEntryVwap)} / ${formatUsd(evaluation.shortEntryVwap)}` : "n/a"}</td>
                  <td>{evaluation ? formatPercent(evaluation.feeDrag) : "n/a"}</td>
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
              <tr><td className="empty-cell" colSpan={10}>没有匹配的同名永续合约。</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
