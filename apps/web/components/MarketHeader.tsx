import { AlertTriangle, ArrowLeftRight, Binoculars, CheckCircle2, Coins, Radar } from "lucide-react";
import type { CrossVenueOpportunityScan, OpportunityScan } from "../lib/api";

export function MarketHeader({
  scan,
  crossVenueScan
}: {
  scan: OpportunityScan | null;
  crossVenueScan: CrossVenueOpportunityScan | null;
}) {
  const rtokenOpen = scan?.openCount ?? 0;
  const crossOpen = crossVenueScan?.openCount ?? 0;
  const candidateCount = (scan?.candidateCount ?? 0) + (crossVenueScan?.watchCount ?? 0);
  const openCount = rtokenOpen + crossOpen;
  const hasOpen = openCount > 0;
  const hasCandidate = candidateCount > 0;
  const headline = hasOpen
    ? `发现 ${openCount} 个扣费后机会`
    : hasCandidate
      ? `发现 ${candidateCount} 个候选机会`
      : "当前无明确开仓机会";
  const subline = hasOpen
    ? `双合约跨市场 ${crossOpen} 个，RToken 现货/合约 ${rtokenOpen} 个；按两边订单簿 VWAP、资金费率和完整往返成本计算。`
    : hasCandidate
      ? "候选不等于立即可交易，需等待价差扩大、费率改善或切换到更小名义金额。"
      : "同名不等于同风险；系统只展示价差，执行前仍需复核指数源、保证金和交易时段。";
  const scannedPairs = (scan?.scannedPairs ?? 0) + (crossVenueScan?.scannedPairs ?? 0);
  const depthIssues = (scan?.depthIssueCount ?? 0) + (crossVenueScan?.depthIssueCount ?? 0);

  return (
    <header className={`hero ${hasOpen ? "hero-live" : hasCandidate ? "hero-watch" : "hero-idle"}`}>
      <div>
        <div className="eyebrow">Cross Sight · Multi-Market Contract Sentinel</div>
        <h1>{headline}</h1>
        <p className="subtitle">{subline}</p>
      </div>
      <div className="hero-status"><Radar size={26} /><span>{hasOpen ? "有机会" : hasCandidate ? "候选机会" : "无机会"}</span></div>
      <div className="stat-strip">
        <div className="stat-tile stat-good"><CheckCircle2 size={18} /><div><strong>{openCount}</strong><span>总机会</span></div></div>
        <div className="stat-tile stat-basis"><ArrowLeftRight size={18} /><div><strong>{crossOpen}</strong><span>双合约跨市场</span></div></div>
        <div className="stat-tile stat-funding"><Coins size={18} /><div><strong>{scan?.basisOpportunityCount ?? 0}</strong><span>RToken 基差</span></div></div>
        <div className="stat-tile stat-watch"><Binoculars size={18} /><div><strong>{candidateCount}</strong><span>候选</span></div></div>
        <div className="stat-tile stat-warn"><AlertTriangle size={18} /><div><strong>{depthIssues}</strong><span>深度不足</span></div></div>
        <div className="stat-tile"><Radar size={18} /><div><strong>{scannedPairs}</strong><span>已扫描</span></div></div>
      </div>
    </header>
  );
}
