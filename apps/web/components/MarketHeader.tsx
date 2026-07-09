import { AlertTriangle, Binoculars, CheckCircle2, Radar, ShieldAlert } from "lucide-react";
import type { OpportunityScan } from "../lib/api";

export function MarketHeader({ scan }: { scan: OpportunityScan }) {
  const hasOpen = scan.openCount > 0;
  const candidateCount = scan.candidateCount ?? 0;
  const hasCandidate = candidateCount > 0;
  const headline = hasOpen
    ? `发现 ${scan.openCount} 个可开仓机会`
    : hasCandidate
      ? `发现 ${candidateCount} 个候选机会`
      : "当前无明确开仓机会";
  const subline =
    hasCandidate && !hasOpen
      ? "这些不是立即开仓信号，适合等待费率恢复、基差扩大或切小额名义金额复核。"
      : scan.closeCount > 0
      ? `${scan.closeCount} 个标的当前费率归零或转负，不适合为了吃费率新开仓。`
      : "扫描结果以深度、资金费率和扣费后 edge 为准，不用 last price 做判断。";

  return (
    <header className={`hero ${hasOpen ? "hero-live" : hasCandidate ? "hero-watch" : "hero-idle"}`}>
      <div>
        <div className="eyebrow">Cross Sight · Bitget RToken Monitor</div>
        <h1>{headline}</h1>
        <p className="subtitle">{subline}</p>
      </div>
      <div className="hero-status">
        {hasOpen ? <Radar size={26} /> : hasCandidate ? <Binoculars size={26} /> : <Radar size={26} />}
        <span>{hasOpen ? "有机会" : hasCandidate ? "候选机会" : "无机会"}</span>
      </div>
      <div className="stat-strip">
        <div className="stat-tile stat-good">
          <CheckCircle2 size={18} />
          <div>
            <strong>{scan.openCount}</strong>
            <span>有机会</span>
          </div>
        </div>
        <div className="stat-tile stat-watch">
          <Binoculars size={18} />
          <div>
            <strong>{candidateCount}</strong>
            <span>候选</span>
          </div>
        </div>
        <div className="stat-tile stat-bad">
          <ShieldAlert size={18} />
          <div>
            <strong>{scan.closeCount}</strong>
            <span>费率归零</span>
          </div>
        </div>
        <div className="stat-tile stat-warn">
          <AlertTriangle size={18} />
          <div>
            <strong>{scan.depthIssueCount}</strong>
            <span>深度不足</span>
          </div>
        </div>
        <div className="stat-tile">
          <Radar size={18} />
          <div>
            <strong>{scan.scannedPairs}</strong>
            <span>已扫描</span>
          </div>
        </div>
      </div>
    </header>
  );
}
