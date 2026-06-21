import { Activity, Clock3, DollarSign, Radio, ShieldAlert, Zap } from "lucide-react";
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

export function FocusPanel({
  scan,
  selectedItem,
  liveEvaluation,
  liveError,
  liveLoading
}: {
  scan: OpportunityScan;
  selectedItem?: OpportunityScanItem;
  liveEvaluation: OpportunityScanItem["evaluation"];
  liveError: string | null;
  liveLoading: boolean;
}) {
  const fallbackFocus = pickFocus(scan);
  const baseFocus = selectedItem ?? fallbackFocus;
  const focus =
    baseFocus && liveEvaluation && liveEvaluation.pair.id === baseFocus.pair.id
      ? { ...baseFocus, evaluation: liveEvaluation }
      : baseFocus;
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
          <div className="pair-sub">{liveLoading ? "实时分析中" : "当前焦点"}</div>
          <h2>{focus.pair.spotSymbol}</h2>
          <p>{focus.pair.futuresSymbol}</p>
        </div>
        <SignalBadge item={focus} large />
      </div>

      <div className="session-strip">
        <Radio size={15} />
        <strong>{evaluation.marketSession.label}</strong>
        <span>
          NY {evaluation.marketSession.newYorkDate} {evaluation.marketSession.newYorkTime}
        </span>
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
          <span>当前费率</span>
          <strong>{formatPercent(evaluation.fundingRate, 4)}</strong>
        </div>
        <div>
          <Clock3 size={16} />
          <span>最近非零 APR</span>
          <strong>
            {evaluation.fundingContext.recentNonZeroApr != null
              ? formatPercent(evaluation.fundingContext.recentNonZeroApr)
              : "近 10 期无"}
          </strong>
        </div>
      </div>

      {liveError ? (
        <div className="inline-warning">
          <ShieldAlert size={15} />
          <span>实时刷新失败，当前展示缓存扫描结果：{liveError}</span>
        </div>
      ) : null}

      <div className="agent-note">
        <div className="agent-label">Agent 判断</div>
        <p>{evaluation.narratorText}</p>
      </div>

      <div className="analysis-stack">
        <div>
          <span>信号结论</span>
          <strong>{evaluation.analysis.signalSummary}</strong>
        </div>
        <div>
          <span>费率解释</span>
          <strong>{evaluation.analysis.fundingSummary}</strong>
        </div>
        <div>
          <span>基差解释</span>
          <strong>{evaluation.analysis.basisSummary}</strong>
        </div>
        <div>
          <span>建议动作</span>
          <strong>{evaluation.analysis.suggestedAction}</strong>
        </div>
      </div>

      <div className="risk-list compact-risk-list">
        {evaluation.analysis.riskNotes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </div>
    </section>
  );
}
