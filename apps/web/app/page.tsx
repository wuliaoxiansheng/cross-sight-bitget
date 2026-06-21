import { BasisRadar } from "../components/BasisRadar";
import { OpportunityFeed } from "../components/OpportunityFeed";
import { PaperTradeLog } from "../components/PaperTradeLog";
import { RiskPanel } from "../components/RiskPanel";
import { getLiveEvaluation } from "../lib/api";

export default async function HomePage() {
  const evaluation = await getLiveEvaluation();

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Cross Sight · RToken Basis Sentry</div>
          <h1>Bitget RToken 费率基差哨兵</h1>
          <p className="subtitle">
            盯住 RToken 现货与对应永续合约之间的价差、资金费率和订单簿深度，判断买现货、空合约是否还有真实可成交 edge。
          </p>
        </div>
        <div className="status-pill">{evaluation.pair.spotSymbol}</div>
      </header>

      <div className="grid">
        <div>
          <BasisRadar evaluation={evaluation} />
          <div style={{ height: 16 }} />
          <PaperTradeLog evaluation={evaluation} />
        </div>
        <div>
          <OpportunityFeed evaluation={evaluation} />
          <div style={{ height: 16 }} />
          <RiskPanel />
        </div>
      </div>
    </main>
  );
}

