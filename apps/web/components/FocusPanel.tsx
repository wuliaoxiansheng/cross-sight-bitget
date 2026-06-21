import { Activity, Clock3, DollarSign, Zap } from "lucide-react";
import type { OpportunityScan, OpportunityScanItem } from "../lib/api";
import { formatPercent, formatUsd } from "../lib/api";
import { SignalBadge } from "./SignalBadge";

function pickFocus(scan: OpportunityScan): OpportunityScanItem | undefined {
  return (
    scan.items.find((item) => item.evaluation?.status === "OPEN" && item.evaluation.depthOk) ??
    scan.items.find((item) => item.evaluation?.status === "CLOSE") ??
    scan.items[0]
  );
}

export function FocusPanel({ scan }: { scan: OpportunityScan }) {
  const focus = pickFocus(scan);
  const evaluation = focus?.evaluation;

  if (!focus || !evaluation) {
    return (
      <section className="panel focus-panel">
        <div className="panel-header">
          <div className="panel-title">当前焦点</div>
        </div>
        <div className="panel-body">没有可展示的扫描结果。</div>
      </section>
    );
  }

  return (
    <section className="panel focus-panel">
      <div className="focus-top">
        <div>
          <div className="pair-sub">当前焦点</div>
          <h2>{focus.pair.spotSymbol}</h2>
          <p>{focus.pair.futuresSymbol}</p>
        </div>
        <SignalBadge item={focus} large />
      </div>

      <div className="focus-metrics">
        <div>
          <Zap size={16} />
          <span>预计 Edge</span>
          <strong>{formatPercent(evaluation.expectedEdge)}</strong>
        </div>
        <div>
          <Activity size={16} />
          <span>开仓基差</span>
          <strong>{formatPercent(evaluation.entryBasis)}</strong>
        </div>
        <div>
          <DollarSign size={16} />
          <span>监控金额</span>
          <strong>{formatUsd(evaluation.notionalUsd)}</strong>
        </div>
        <div>
          <Clock3 size={16} />
          <span>资金费率</span>
          <strong>{formatPercent(evaluation.fundingApr)}</strong>
        </div>
      </div>

      <div className="agent-note">
        <div className="agent-label">Agent 判断</div>
        <p>{evaluation.narratorText}</p>
      </div>
    </section>
  );
}

