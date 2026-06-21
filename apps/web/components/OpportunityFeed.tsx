import type { BasisEvaluation } from "../lib/api";

export function OpportunityFeed({ evaluation }: { evaluation: BasisEvaluation }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div className="panel-title">Agent 告警流</div>
      </div>
      <div className="panel-body">
        <div className="feed">
          <article className="feed-item">
            <div className="feed-time">{new Date(evaluation.timestamp).toLocaleString("zh-CN")}</div>
            <p className="feed-text">{evaluation.narratorText}</p>
          </article>
          <article className="feed-item">
            <div className="feed-time">策略解释</div>
            <p className="feed-text">{evaluation.reason}</p>
          </article>
        </div>
      </div>
    </section>
  );
}

