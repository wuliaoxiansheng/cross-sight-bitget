import type { BasisEvaluation } from "../lib/api";
import { formatPercent, formatUsd } from "../lib/api";

export function PaperTradeLog({ evaluation }: { evaluation: BasisEvaluation }) {
  const action = evaluation.status === "OPEN" ? "OPEN" : evaluation.status === "CLOSE" ? "CLOSE" : "HOLD";
  const estimatedPnl = evaluation.notionalUsd * evaluation.expectedEdge;

  return (
    <section className="panel">
      <div className="panel-header">
        <div className="panel-title">Paper Trading 预览</div>
      </div>
      <div className="panel-body">
        <table className="table">
          <thead>
            <tr>
              <th>时间</th>
              <th>动作</th>
              <th>交易对</th>
              <th>名义金额</th>
              <th>Edge</th>
              <th>估算 PnL</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{new Date(evaluation.timestamp).toLocaleTimeString("zh-CN")}</td>
              <td>{action}</td>
              <td>
                {evaluation.pair.spotSymbol} / {evaluation.pair.futuresSymbol}
              </td>
              <td>{formatUsd(evaluation.notionalUsd)}</td>
              <td>{formatPercent(evaluation.expectedEdge)}</td>
              <td>{formatUsd(estimatedPnl)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

