import { Activity, ArrowDownUp, CircleDollarSign, RadioTower } from "lucide-react";
import type { BasisEvaluation } from "../lib/api";
import { formatPercent, formatUsd } from "../lib/api";

const statusClass: Record<BasisEvaluation["status"], string> = {
  OPEN: "positive",
  HOLD: "warning",
  CLOSE: "danger",
  WAIT: ""
};

export function BasisRadar({ evaluation }: { evaluation: BasisEvaluation }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">套利雷达</div>
          <p className="metric-note">
            {evaluation.pair.spotSymbol} / {evaluation.pair.futuresSymbol}
          </p>
        </div>
        <div className={`status-pill ${statusClass[evaluation.status]}`}>{evaluation.status}</div>
      </div>
      <div className="panel-body">
        <div className="metric-grid">
          <div className="metric">
            <div className="metric-label">
              <ArrowDownUp size={14} /> 开仓基差
            </div>
            <div className="metric-value">{formatPercent(evaluation.entryBasis)}</div>
            <div className="metric-note">合约做空 VWAP / 现货买入 VWAP</div>
          </div>
          <div className="metric">
            <div className="metric-label">
              <RadioTower size={14} /> 资金费率年化
            </div>
            <div className="metric-value">{formatPercent(evaluation.fundingApr)}</div>
            <div className="metric-note">按 Bitget 当前结算周期折算</div>
          </div>
          <div className="metric">
            <div className="metric-label">
              <CircleDollarSign size={14} /> 预计 Edge
            </div>
            <div className="metric-value">{formatPercent(evaluation.expectedEdge)}</div>
            <div className="metric-note">基差 + 预计费率 - 双边手续费</div>
          </div>
          <div className="metric">
            <div className="metric-label">
              <Activity size={14} /> 监控规模
            </div>
            <div className="metric-value">{formatUsd(evaluation.notionalUsd)}</div>
            <div className="metric-note">{evaluation.depthOk ? "订单簿可覆盖" : "深度不足"}</div>
          </div>
        </div>

        <div className="two-col">
          <div className="metric">
            <div className="metric-label">现货买入 VWAP</div>
            <div className="metric-value">{formatUsd(evaluation.spotBuyVwap)}</div>
            <div className="metric-note">买入 {evaluation.pair.spotSymbol}</div>
          </div>
          <div className="metric">
            <div className="metric-label">合约做空 VWAP</div>
            <div className="metric-value">{formatUsd(evaluation.futuresShortVwap)}</div>
            <div className="metric-note">做空 {evaluation.pair.futuresSymbol}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

