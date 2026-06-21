import { FocusPanel } from "../components/FocusPanel";
import { MarketHeader } from "../components/MarketHeader";
import { OpportunityTable } from "../components/OpportunityTable";
import { RiskNotes } from "../components/RiskNotes";
import { getLiveScan } from "../lib/api";

export default async function HomePage() {
  const scan = await getLiveScan();

  return (
    <main className="shell">
      <MarketHeader scan={scan} />

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

