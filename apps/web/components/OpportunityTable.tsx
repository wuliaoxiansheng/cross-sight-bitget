import type { OpportunityScan } from "../lib/api";
import { formatPercent, formatUsd } from "../lib/api";
import { SignalBadge } from "./SignalBadge";

export function OpportunityTable({ scan }: { scan: OpportunityScan }) {
  return (
    <section className="panel scanner-panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">热门 RToken 扫描</div>
          <p className="panel-subtitle">严格配对：rSPY → SPYUSDT，rQQQ → QQQUSDT；不做模糊匹配。</p>
        </div>
        <div className="scan-time">{new Date(scan.generatedAt).toLocaleTimeString("zh-CN")}</div>
      </div>
      <div className="table-wrap">
        <table className="opportunity-table">
          <thead>
            <tr>
              <th>标的</th>
              <th>信号</th>
              <th>Edge</th>
              <th>开仓基差</th>
              <th>费率年化</th>
              <th>现货 / 合约 VWAP</th>
              <th>成交额</th>
            </tr>
          </thead>
          <tbody>
            {scan.items.map((item) => {
              const evaluation = item.evaluation;
              return (
                <tr key={item.pair.id} className={evaluation?.status === "OPEN" ? "row-open" : ""}>
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
                  <td>{evaluation ? formatPercent(evaluation.fundingApr) : "n/a"}</td>
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
          </tbody>
        </table>
      </div>
    </section>
  );
}
