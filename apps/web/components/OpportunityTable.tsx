import type { OpportunityScan } from "../lib/api";
import { formatPercent, formatUsd } from "../lib/api";
import { SignalBadge } from "./SignalBadge";

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
              <th>Edge</th>
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
              return (
                <tr
                  key={item.pair.id}
                  className={`${evaluation?.status === "OPEN" ? "row-open" : ""} ${
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
                  <td
                    className={
                      evaluation?.status === "OPEN" && evaluation.depthOk && evaluation.expectedEdge > 0
                        ? "positive"
                        : "muted"
                    }
                  >
                    {evaluation ? formatPercent(evaluation.expectedEdge) : "n/a"}
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
                <td className="empty-cell" colSpan={8}>
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
