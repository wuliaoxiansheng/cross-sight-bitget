import { Activity, ArrowDown, ArrowUp, Clock3, DollarSign, Radio, ShieldAlert } from "lucide-react";
import type { CrossVenueEvaluation, CrossVenueOpportunityScan, CrossVenueScanItem } from "../lib/api";
import { formatPercent, formatUsd } from "../lib/api";

function venueLabel(venue: "bitget" | "hyperliquid_xyz"): string {
  return venue === "bitget" ? "Bitget" : "Hyperliquid xyz";
}

function opportunityKindLabel(evaluation: CrossVenueEvaluation): string {
  if (evaluation.opportunityKind === "spread_convergence") return "历史异常价差收敛";
  if (evaluation.opportunityKind === "funding_carry") return "跨市场费率套利";
  if (evaluation.opportunityKind === "snapshot_basis") return "瞬时价差";
  return evaluation.convergence.historicalReady ? "暂无明确机会" : "历史模型学习中";
}

export function CrossVenueFocus({
  scan,
  selectedItem,
  liveEvaluation,
  liveError,
  liveLoading
}: {
  scan: CrossVenueOpportunityScan;
  selectedItem?: CrossVenueScanItem;
  liveEvaluation: CrossVenueEvaluation | null;
  liveError: string | null;
  liveLoading: boolean;
}) {
  const base = selectedItem ?? scan.items[0];
  const evaluation = base && liveEvaluation?.pair.id === base.pair.id ? liveEvaluation : base?.evaluation;

  if (!base || !evaluation) {
    return <section className="panel focus-panel"><div className="panel-title">跨市场焦点</div><p className="panel-subtitle">没有可展示的扫描结果。</p></section>;
  }

  const tone = evaluation.status === "OPEN" ? "signal-good" : evaluation.status === "WATCH" ? "signal-warn" : "signal-muted";
  return (
    <section className="panel focus-panel">
      <div className="focus-top">
        <div>
          <div className="pair-sub">{liveLoading ? "实时盘口分析中" : "双合约焦点"}</div>
          <h2>{base.pair.ticker}</h2>
          <p>{base.pair.bitgetSymbol} ↔ {base.pair.hyperliquidCoin}</p>
        </div>
        <span className={`signal-badge signal-large ${tone}`}>{evaluation.opportunityLabel}</span>
      </div>

      <div className="cross-direction">
        <div><ArrowUp size={17} /><span>做多</span><strong>{venueLabel(evaluation.longVenue)}</strong></div>
        <div><ArrowDown size={17} /><span>做空</span><strong>{venueLabel(evaluation.shortVenue)}</strong></div>
      </div>

      <div className="session-strip">
        <Radio size={15} />
        <strong>{opportunityKindLabel(evaluation)}</strong>
        <span>{evaluation.convergence.sampleCount} 个历史样本 · {evaluation.convergence.windowHours.toFixed(1)} 小时窗口</span>
      </div>

      <div className="focus-metrics">
        <div><Activity size={16} /><span>预估净 Edge</span><strong>{formatPercent(evaluation.expectedEdge)}</strong></div>
        <div><Activity size={16} /><span>可成交基差</span><strong>{formatPercent(evaluation.entryBasis)}</strong></div>
        <div><Activity size={16} /><span>回归中枢毛空间</span><strong>{formatPercent(evaluation.convergenceGrossEdge)}</strong></div>
        <div><Activity size={16} /><span>收敛策略净 Edge</span><strong>{formatPercent(evaluation.convergenceExpectedEdge)}</strong></div>
        <div><Clock3 size={16} /><span>{evaluation.fundingHorizonHours}h 费率贡献</span><strong>{formatPercent(evaluation.expectedFundingEdge, 3)}</strong></div>
        <div><DollarSign size={16} /><span>双边往返费用</span><strong>{formatPercent(evaluation.feeDrag)}</strong></div>
        <div><ArrowUp size={16} /><span>多头 VWAP</span><strong>{formatUsd(evaluation.longEntryVwap)}</strong></div>
        <div><ArrowDown size={16} /><span>空头 VWAP</span><strong>{formatUsd(evaluation.shortEntryVwap)}</strong></div>
        <div><Clock3 size={16} /><span>Bitget 单期费率</span><strong>{formatPercent(evaluation.bitgetFundingRate, 4)}</strong></div>
        <div><Clock3 size={16} /><span>Hyperliquid 每小时</span><strong>{formatPercent(evaluation.hyperliquidFundingRate, 4)}</strong></div>
        <div><DollarSign size={16} /><span>监控金额</span><strong>{formatUsd(evaluation.notionalUsd)}</strong></div>
        <div><DollarSign size={16} /><span>最佳可执行档</span><strong>{evaluation.bestExecutableBand ? formatUsd(evaluation.bestExecutableBand.notionalUsd) : "暂无"}</strong></div>
      </div>

      <div className="analysis-stack">
        <div>
          <span>历史偏离</span>
          <strong>
            {evaluation.convergence.historicalReady
              ? `Z ${evaluation.convergence.zScore.toFixed(2)} · 历史分位 ${(evaluation.convergence.absoluteDeviationPercentile * 100).toFixed(1)}%`
              : `样本 ${evaluation.convergence.sampleCount} 个，尚未达到模型最低要求`}
          </strong>
        </div>
        <div>
          <span>正常价差中枢</span>
          <strong>{formatPercent(evaluation.convergence.medianSignedSpread)} · 当前偏离 {formatPercent(evaluation.convergence.deviationFromMedian)}</strong>
        </div>
        <div>
          <span>历史收敛特征</span>
          <strong>
            半衰期 {evaluation.convergence.halfLifeHours != null ? `${evaluation.convergence.halfLifeHours.toFixed(1)} 小时` : "暂不可估"}
            {evaluation.convergence.historicalConvergenceRate != null
              ? ` · 4 小时内向中枢回归 ${(evaluation.convergence.historicalConvergenceRate * 100).toFixed(0)}%（${evaluation.convergence.historicalConvergenceObservations} 次）`
              : " · 暂无足够异常样本"}
          </strong>
        </div>
        <div>
          <span>收益拆解</span>
          <strong>收敛毛空间 {formatPercent(evaluation.convergenceGrossEdge)} + 费率 {formatPercent(evaluation.expectedFundingEdge, 3)} - 往返费用 {formatPercent(evaluation.feeDrag)} = {formatPercent(evaluation.convergenceExpectedEdge)}</strong>
        </div>
      </div>

      {liveError ? <div className="inline-warning"><ShieldAlert size={15} /><span>实时刷新失败，当前显示缓存：{liveError}</span></div> : null}

      <div className="agent-note">
        <div className="agent-label">Agent 判断</div>
        <p>{evaluation.reason}</p>
      </div>
      <div className="risk-list compact-risk-list">
        {evaluation.riskNotes.map((note) => <p key={note}>{note}</p>)}
      </div>
    </section>
  );
}
