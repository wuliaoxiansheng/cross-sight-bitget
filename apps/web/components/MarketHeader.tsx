import { AlertTriangle, CheckCircle2, Radar, ShieldAlert } from "lucide-react";
import type { OpportunityScan } from "../lib/api";

export function MarketHeader({ scan }: { scan: OpportunityScan }) {
  const hasOpen = scan.openCount > 0;
  const headline = hasOpen ? `发现 ${scan.openCount} 个可开仓机会` : "当前无明确开仓机会";
  const subline =
    scan.closeCount > 0
      ? `${scan.closeCount} 个标的更像平仓窗口，先看是否已有仓位需要退出。`
      : "扫描结果以深度、资金费率和扣费后 edge 为准，不用 last price 做判断。";

  return (
    <header className={`hero ${hasOpen ? "hero-live" : "hero-idle"}`}>
      <div>
        <div className="eyebrow">Cross Sight · Bitget RToken Monitor</div>
        <h1>{headline}</h1>
        <p className="subtitle">{subline}</p>
      </div>
      <div className="hero-status">
        <Radar size={26} />
        <span>{hasOpen ? "有机会" : "无机会"}</span>
      </div>
      <div className="stat-strip">
        <div className="stat-tile stat-good">
          <CheckCircle2 size={18} />
          <div>
            <strong>{scan.openCount}</strong>
            <span>有机会</span>
          </div>
        </div>
        <div className="stat-tile stat-bad">
          <ShieldAlert size={18} />
          <div>
            <strong>{scan.closeCount}</strong>
            <span>适合平仓</span>
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

