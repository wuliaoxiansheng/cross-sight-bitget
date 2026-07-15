"use client";

import { ArrowLeftRight, Coins, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CrossVenueFocus } from "./CrossVenueFocus";
import { CrossVenueTable } from "./CrossVenueTable";
import { FocusPanel } from "./FocusPanel";
import { MarketHeader } from "./MarketHeader";
import { OpportunityTable } from "./OpportunityTable";
import { RiskNotes } from "./RiskNotes";
import type {
  BasisEvaluation,
  CrossVenueEvaluation,
  CrossVenueOpportunityScan,
  CrossVenueScanItem,
  OpportunityScan,
  OpportunityScanItem,
  OpportunitySnapshot
} from "../lib/api";
import { API_BASE_URL, getLiveCrossVenueOpportunity, getLiveOpportunity } from "../lib/api";

type MarketMode = "cross" | "rtoken";
type SignalFilter = "all" | "open" | "basis" | "funding" | "candidate" | "small-size" | "funding-watch" | "funding-zero" | "recent-funding" | "depth" | "none";
type CrossFilter = "all" | "open" | "convergence" | "funding" | "basis" | "watch" | "depth" | "none";

const RTOKEN_FILTERS: Array<{ id: SignalFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "open", label: "有机会" },
  { id: "basis", label: "RToken 基差" },
  { id: "funding", label: "费率 + 价差" },
  { id: "candidate", label: "候选" },
  { id: "small-size", label: "小额" },
  { id: "funding-watch", label: "等费率" },
  { id: "funding-zero", label: "费率归零" },
  { id: "recent-funding", label: "最近非零" },
  { id: "depth", label: "深度不足" },
  { id: "none", label: "无机会" }
];

const CROSS_FILTERS: Array<{ id: CrossFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "open", label: "有机会" },
  { id: "convergence", label: "价差收敛" },
  { id: "funding", label: "费率套利" },
  { id: "basis", label: "瞬时价差" },
  { id: "watch", label: "候选" },
  { id: "depth", label: "深度不足" },
  { id: "none", label: "无机会" }
];

function statusText(snapshot: OpportunitySnapshot): string {
  if (snapshot.status === "warming") return "后台首次扫描中";
  if (snapshot.status === "scanning") return "正在扫描 Bitget RToken 与跨市场永续";
  if (snapshot.status === "stale") return "缓存偏旧，等待下一轮刷新";
  if (snapshot.status === "error") return "扫描服务异常";
  return "双市场缓存已更新";
}

function pickDefaultRToken(scan: OpportunityScan): OpportunityScanItem | undefined {
  return scan.items.find((item) => item.evaluation?.status === "OPEN" && item.evaluation.depthOk) ??
    scan.items.find((item) => item.evaluation?.opportunityKind?.startsWith("watch_")) ??
    scan.items.find((item) => item.evaluation?.status === "CLOSE") ?? scan.items[0];
}

function pickDefaultCross(scan: CrossVenueOpportunityScan): CrossVenueScanItem | undefined {
  return scan.items.find((item) => item.evaluation?.status === "OPEN" && item.evaluation.depthOk) ??
    scan.items.find((item) => item.evaluation?.status === "WATCH") ?? scan.items[0];
}

function rtokenSearchText(item: OpportunityScanItem): string {
  const underlying = item.pair.spotSymbol.replace(/^R/i, "").replace(/USDT$/i, "");
  return [item.pair.id, item.pair.name, item.pair.spotSymbol, item.pair.futuresSymbol, underlying].join(" ").toLowerCase();
}

function matchesRTokenFilter(item: OpportunityScanItem, filter: SignalFilter): boolean {
  const evaluation = item.evaluation;
  if (filter === "all") return true;
  if (!evaluation) return false;
  if (filter === "open") return evaluation.status === "OPEN" && evaluation.depthOk;
  if (filter === "basis") return evaluation.opportunityKind === "basis_convergence";
  if (filter === "funding") return evaluation.opportunityKind === "executable";
  if (filter === "candidate") return evaluation.opportunityKind.startsWith("watch_");
  if (filter === "small-size") return evaluation.opportunityKind === "watch_small_size";
  if (filter === "funding-watch") return evaluation.opportunityKind === "watch_funding_return";
  if (filter === "funding-zero") return evaluation.status === "CLOSE" && evaluation.fundingRate === 0;
  if (filter === "recent-funding") return evaluation.fundingContext.recentNonZeroRate != null;
  if (filter === "depth") return !evaluation.depthOk;
  return evaluation.depthOk && evaluation.status !== "OPEN" && evaluation.status !== "CLOSE";
}

function matchesCrossFilter(item: CrossVenueScanItem, filter: CrossFilter): boolean {
  if (filter === "all") return true;
  if (!item.evaluation) return filter === "none";
  if (filter === "open") return item.evaluation.status === "OPEN";
  if (filter === "convergence") return item.evaluation.opportunityKind === "spread_convergence";
  if (filter === "funding") return item.evaluation.opportunityKind === "funding_carry";
  if (filter === "basis") return item.evaluation.opportunityKind === "snapshot_basis";
  if (filter === "watch") return item.evaluation.status === "WATCH";
  if (filter === "depth") return !item.evaluation.depthOk;
  return item.evaluation.status === "WAIT" && item.evaluation.depthOk;
}

export function DashboardClient({ initialSnapshot }: { initialSnapshot: OpportunitySnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [mode, setMode] = useState<MarketMode>(initialSnapshot.crossVenueScan ? "cross" : "rtoken");
  const [query, setQuery] = useState("");
  const [rtokenFilter, setRTokenFilter] = useState<SignalFilter>("all");
  const [crossFilter, setCrossFilter] = useState<CrossFilter>("all");
  const [selectedPairId, setSelectedPairId] = useState<string | null>(() =>
    initialSnapshot.latestScan ? pickDefaultRToken(initialSnapshot.latestScan)?.pair.id ?? null : null
  );
  const [selectedCrossPairId, setSelectedCrossPairId] = useState<string | null>(() =>
    initialSnapshot.crossVenueScan ? pickDefaultCross(initialSnapshot.crossVenueScan)?.pair.id ?? null : null
  );
  const [liveEvaluation, setLiveEvaluation] = useState<BasisEvaluation | null>(null);
  const [liveCrossEvaluation, setLiveCrossEvaluation] = useState<CrossVenueEvaluation | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);

  useEffect(() => {
    const source = new EventSource(`${API_BASE_URL}/opportunities/stream`);
    source.addEventListener("snapshot", (event) => {
      try {
        setSnapshot(JSON.parse((event as MessageEvent).data) as OpportunitySnapshot);
      } catch {
        // Keep the last complete frame when an SSE message is malformed.
      }
    });
    return () => source.close();
  }, []);

  const scan = snapshot.latestScan;
  const crossScan = snapshot.crossVenueScan;
  const selectedItem = useMemo(() => scan?.items.find((item) => item.pair.id === selectedPairId), [scan, selectedPairId]);
  const selectedCrossItem = useMemo(
    () => crossScan?.items.find((item) => item.pair.id === selectedCrossPairId),
    [crossScan, selectedCrossPairId]
  );
  const updatedAt = useMemo(
    () => snapshot.completedAt ? new Date(snapshot.completedAt).toLocaleTimeString("zh-CN") : "尚未完成",
    [snapshot.completedAt]
  );

  const filteredScan = useMemo(() => {
    if (!scan) return null;
    const normalized = query.trim().toLowerCase();
    return {
      ...scan,
      items: scan.items.filter((item) =>
        (!normalized || rtokenSearchText(item).includes(normalized)) && matchesRTokenFilter(item, rtokenFilter)
      )
    };
  }, [query, rtokenFilter, scan]);

  const filteredCrossScan = useMemo(() => {
    if (!crossScan) return null;
    const normalized = query.trim().toLowerCase();
    return {
      ...crossScan,
      items: crossScan.items.filter((item) => {
        const text = [item.pair.id, item.pair.ticker, item.pair.bitgetSymbol, item.pair.hyperliquidCoin].join(" ").toLowerCase();
        return (!normalized || text.includes(normalized)) && matchesCrossFilter(item, crossFilter);
      })
    };
  }, [crossFilter, crossScan, query]);

  useEffect(() => {
    if (scan && (!selectedPairId || !scan.items.some((item) => item.pair.id === selectedPairId))) {
      setSelectedPairId(pickDefaultRToken(scan)?.pair.id ?? null);
    }
  }, [scan, selectedPairId]);

  useEffect(() => {
    if (crossScan && (!selectedCrossPairId || !crossScan.items.some((item) => item.pair.id === selectedCrossPairId))) {
      setSelectedCrossPairId(pickDefaultCross(crossScan)?.pair.id ?? null);
    }
  }, [crossScan, selectedCrossPairId]);

  useEffect(() => {
    const item = mode === "cross" ? selectedCrossItem : selectedItem;
    if (!item) return;
    let cancelled = false;
    setLiveLoading(true);
    setLiveError(null);

    const request = mode === "cross"
      ? getLiveCrossVenueOpportunity(item.pair as CrossVenueScanItem["pair"], crossScan?.notionalUsd ?? 5_000)
      : getLiveOpportunity(item.pair as OpportunityScanItem["pair"], scan?.notionalUsd ?? 5_000);

    request.then((evaluation) => {
      if (cancelled) return;
      if (mode === "cross") setLiveCrossEvaluation(evaluation as CrossVenueEvaluation);
      else setLiveEvaluation(evaluation as BasisEvaluation);
    }).catch((error: unknown) => {
      if (!cancelled) setLiveError(error instanceof Error ? error.message : "实时分析失败");
    }).finally(() => {
      if (!cancelled) setLiveLoading(false);
    });

    return () => { cancelled = true; };
  }, [crossScan?.notionalUsd, mode, scan?.notionalUsd, selectedCrossItem, selectedItem]);

  if (!scan && !crossScan) {
    const isError = snapshot.status === "error";
    return (
      <main className="shell">
        <section className="hero hero-idle">
          <div><div className="eyebrow">Cross Sight · Multi-Market Sentinel</div><h1>{isError ? "行情 API 暂不可用" : "后台正在扫描"}</h1>
            <p className="subtitle">{isError ? snapshot.lastError ?? "当前没有可展示的实时行情数据。" : "正在读取 Bitget RToken、Bitget RWA 永续和 Hyperliquid xyz 永续盘口。"}</p></div>
          <div className="hero-status">{isError ? "异常" : "扫描中"}</div>
        </section>
      </main>
    );
  }

  const activeFilters = mode === "cross" ? CROSS_FILTERS : RTOKEN_FILTERS;
  const activeFilter = mode === "cross" ? crossFilter : rtokenFilter;
  return (
    <main className="shell">
      <MarketHeader scan={scan} crossVenueScan={crossScan} />
      <div className="scan-bar">
        <strong>{statusText(snapshot)}</strong><span>最后更新：{updatedAt}</span>
        <span>RToken：{scan?.scannedPairs ?? 0} 个</span><span>双合约：{crossScan?.scannedPairs ?? 0} 个</span>
        <span>下次扫描：{snapshot.nextRunAt ? new Date(snapshot.nextRunAt).toLocaleTimeString("zh-CN") : "排队中"}</span>
      </div>

      <nav className="market-switch" aria-label="监控市场">
        <button type="button" className={mode === "cross" ? "market-active" : ""} onClick={() => { setMode("cross"); setQuery(""); }}>
          <ArrowLeftRight size={18} /><span>双合约跨市场</span><strong>{crossScan?.openCount ?? 0}</strong>
        </button>
        <button type="button" className={mode === "rtoken" ? "market-active" : ""} onClick={() => { setMode("rtoken"); setQuery(""); }}>
          <Coins size={18} /><span>RToken 现货 / 合约</span><strong>{scan?.openCount ?? 0}</strong>
        </button>
      </nav>

      <section className="scanner-controls" aria-label="扫描筛选">
        <label className="search-box"><Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mode === "cross" ? "搜索 SKHY、NVDA、KIOXIA..." : "搜索 RSPCX、SPCXUSDT、COIN..."} />
        </label>
        <div className="filter-tabs"><SlidersHorizontal size={16} />
          {activeFilters.map((item) => (
            <button key={item.id} className={item.id === activeFilter ? "filter-active" : ""} type="button" onClick={() => {
              if (mode === "cross") setCrossFilter(item.id as CrossFilter);
              else setRTokenFilter(item.id as SignalFilter);
            }}>{item.label}</button>
          ))}
        </div>
      </section>

      <div className="dashboard-grid">
        <div>
          {mode === "cross" && crossScan ? (
            <CrossVenueTable scan={filteredCrossScan ?? crossScan} selectedPairId={selectedCrossPairId} onSelectPair={(item) => { setSelectedCrossPairId(item.pair.id); setLiveCrossEvaluation(null); }} />
          ) : mode === "rtoken" && scan ? (
            <OpportunityTable scan={filteredScan ?? scan} selectedPairId={selectedPairId} onSelectPair={(item) => { setSelectedPairId(item.pair.id); setLiveEvaluation(null); }} />
          ) : <section className="panel empty-mode">该市场扫描暂不可用，后台会在下一轮重试。</section>}
        </div>
        <aside className="side-stack">
          {mode === "cross" && crossScan ? (
            <CrossVenueFocus scan={crossScan} selectedItem={selectedCrossItem} liveEvaluation={liveCrossEvaluation} liveError={liveError} liveLoading={liveLoading} />
          ) : mode === "rtoken" && scan ? (
            <FocusPanel scan={scan} selectedItem={selectedItem} liveEvaluation={liveEvaluation} liveError={liveError} liveLoading={liveLoading} />
          ) : null}
          <RiskNotes />
        </aside>
      </div>
    </main>
  );
}
