"use client";

import { useEffect, useMemo, useState } from "react";
import { FocusPanel } from "./FocusPanel";
import { MarketHeader } from "./MarketHeader";
import { OpportunityTable } from "./OpportunityTable";
import { RiskNotes } from "./RiskNotes";
import type { OpportunitySnapshot } from "../lib/api";
import { API_BASE_URL } from "../lib/api";

function statusText(snapshot: OpportunitySnapshot): string {
  if (snapshot.status === "warming") return "后台首次扫描中";
  if (snapshot.status === "scanning") return "正在扫描 Bitget RToken";
  if (snapshot.status === "stale") return "缓存偏旧，等待下一轮刷新";
  if (snapshot.status === "error") return "扫描服务异常";
  return "缓存已更新";
}

export function DashboardClient({ initialSnapshot }: { initialSnapshot: OpportunitySnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);

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
  const updatedAt = useMemo(() => {
    if (!snapshot.completedAt) return "尚未完成";
    return new Date(snapshot.completedAt).toLocaleTimeString("zh-CN");
  }, [snapshot.completedAt]);

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
        <span>后台上限：{snapshot.limit} 个</span>
        <span>下次扫描：{snapshot.nextRunAt ? new Date(snapshot.nextRunAt).toLocaleTimeString("zh-CN") : "排队中"}</span>
      </div>

      <div className="dashboard-grid">
        <div>
          <OpportunityTable scan={scan} />
        </div>
        <aside className="side-stack">
          <FocusPanel scan={scan} />
          <RiskNotes />
        </aside>
      </div>
    </main>
  );
}
