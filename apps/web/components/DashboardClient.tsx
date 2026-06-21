"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FocusPanel } from "./FocusPanel";
import { MarketHeader } from "./MarketHeader";
import { OpportunityTable } from "./OpportunityTable";
import { RiskNotes } from "./RiskNotes";
import type { BasisEvaluation, OpportunityScan, OpportunityScanItem, OpportunitySnapshot } from "../lib/api";
import { API_BASE_URL, getLiveOpportunity } from "../lib/api";

type SignalFilter = "all" | "open" | "funding-zero" | "recent-funding" | "depth" | "none";

const FILTERS: Array<{ id: SignalFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "open", label: "有机会" },
  { id: "funding-zero", label: "费率归零" },
  { id: "recent-funding", label: "最近非零" },
  { id: "depth", label: "深度不足" },
  { id: "none", label: "无机会" }
];

function statusText(snapshot: OpportunitySnapshot): string {
  if (snapshot.status === "warming") return "后台首次扫描中";
  if (snapshot.status === "scanning") return "正在扫描 Bitget RToken";
  if (snapshot.status === "stale") return "缓存偏旧，等待下一轮刷新";
  if (snapshot.status === "error") return "扫描服务异常";
  return "缓存已更新";
}

function pickDefaultItem(scan: OpportunityScan): OpportunityScanItem | undefined {
  return (
    scan.items.find((item) => item.evaluation?.status === "OPEN" && item.evaluation.depthOk) ??
    scan.items.find((item) => item.evaluation?.status === "CLOSE") ??
    scan.items[0]
  );
}

function searchText(item: OpportunityScanItem): string {
  const underlying = item.pair.spotSymbol.replace(/^R/i, "").replace(/USDT$/i, "");
  return [item.pair.id, item.pair.name, item.pair.spotSymbol, item.pair.futuresSymbol, underlying]
    .join(" ")
    .toLowerCase();
}

function matchesFilter(item: OpportunityScanItem, filter: SignalFilter): boolean {
  const evaluation = item.evaluation;
  if (filter === "all") return true;
  if (!evaluation) return false;
  if (filter === "open") return evaluation.status === "OPEN" && evaluation.depthOk;
  if (filter === "funding-zero") return evaluation.status === "CLOSE" && evaluation.fundingRate === 0;
  if (filter === "recent-funding") return evaluation.fundingContext.recentNonZeroRate != null;
  if (filter === "depth") return !evaluation.depthOk;
  return evaluation.depthOk && evaluation.status !== "OPEN" && evaluation.status !== "CLOSE";
}

export function DashboardClient({ initialSnapshot }: { initialSnapshot: OpportunitySnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SignalFilter>("all");
  const [selectedPairId, setSelectedPairId] = useState<string | null>(() => {
    const scan = initialSnapshot.latestScan;
    return scan ? (pickDefaultItem(scan)?.pair.id ?? null) : null;
  });
  const [liveEvaluation, setLiveEvaluation] = useState<BasisEvaluation | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);

  useEffect(() => {
    const source = new EventSource(`${API_BASE_URL}/opportunities/stream`);

    source.addEventListener("snapshot", (event) => {
      try {
        setSnapshot(JSON.parse((event as MessageEvent).data) as OpportunitySnapshot);
      } catch {
        // Ignore malformed stream frames and keep the last good snapshot.
      }
    });

    return () => source.close();
  }, []);

  const scan = snapshot.latestScan;
  const selectedItem = useMemo(() => {
    if (!scan || !selectedPairId) return undefined;
    return scan.items.find((item) => item.pair.id === selectedPairId);
  }, [scan, selectedPairId]);
  const updatedAt = useMemo(() => {
    if (!snapshot.completedAt) return "尚未完成";
    return new Date(snapshot.completedAt).toLocaleTimeString("zh-CN");
  }, [snapshot.completedAt]);
  const filteredScan = useMemo(() => {
    if (!scan) return null;
    const normalizedQuery = query.trim().toLowerCase();
    const items = scan.items.filter((item) => {
      const queryOk = normalizedQuery.length === 0 || searchText(item).includes(normalizedQuery);
      return queryOk && matchesFilter(item, filter);
    });

    return {
      ...scan,
      items
    };
  }, [filter, query, scan]);

  useEffect(() => {
    if (!scan) return;
    if (selectedPairId && scan.items.some((item) => item.pair.id === selectedPairId)) return;
    setSelectedPairId(pickDefaultItem(scan)?.pair.id ?? null);
  }, [scan, selectedPairId]);

  useEffect(() => {
    if (!selectedItem) {
      setLiveEvaluation(null);
      return;
    }

    const controller = new AbortController();
    setLiveLoading(true);
    setLiveError(null);

    getLiveOpportunity(selectedItem.pair, scan?.notionalUsd ?? 5000)
      .then((evaluation) => {
        if (!controller.signal.aborted) {
          setLiveEvaluation(evaluation);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLiveEvaluation(null);
          setLiveError(error instanceof Error ? error.message : "实时分析失败");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLiveLoading(false);
        }
      });

    return () => controller.abort();
  }, [scan?.notionalUsd, selectedItem]);

  if (!scan) {
    return (
      <main className="shell">
        <section className="hero hero-idle">
          <div>
            <div className="eyebrow">Cross Sight · Bitget RToken Monitor</div>
            <h1>后台正在扫描</h1>
            <p className="subtitle">服务端正在逐批读取 Bitget 热门 RToken、订单簿和资金费率。完成后页面会自动更新。</p>
          </div>
          <div className="hero-status">扫描中</div>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <MarketHeader scan={scan} />
      <div className="scan-bar">
        <strong>{statusText(snapshot)}</strong>
        <span>最后更新：{updatedAt}</span>
        <span>后台范围：{snapshot.limit == null ? "全量 RToken" : `${snapshot.limit} 个`}</span>
        <span>下次扫描：{snapshot.nextRunAt ? new Date(snapshot.nextRunAt).toLocaleTimeString("zh-CN") : "排队中"}</span>
      </div>

      <section className="scanner-controls" aria-label="扫描筛选">
        <label className="search-box">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder="搜索 RSPCX、SPCXUSDT、COIN、NVDA..."
          />
        </label>
        <div className="filter-tabs" aria-label="信号筛选">
          <SlidersHorizontal size={16} />
          {FILTERS.map((item) => (
            <button
              key={item.id}
              className={item.id === filter ? "filter-active" : ""}
              type="button"
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <div className="dashboard-grid">
        <div>
          <OpportunityTable
            scan={filteredScan ?? scan}
            selectedPairId={selectedPairId}
            onSelectPair={(item) => {
              setSelectedPairId(item.pair.id);
              setLiveEvaluation(null);
            }}
          />
        </div>
        <aside className="side-stack">
          <FocusPanel
            scan={scan}
            selectedItem={selectedItem}
            liveEvaluation={liveEvaluation}
            liveError={liveError}
            liveLoading={liveLoading}
          />
          <RiskNotes />
        </aside>
      </div>
    </main>
  );
}
