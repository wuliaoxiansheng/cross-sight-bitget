import { DashboardClient } from "../components/DashboardClient";
import { getOpportunitySnapshot } from "../lib/api";

export default async function HomePage() {
  const snapshot = await getOpportunitySnapshot();

  return <DashboardClient initialSnapshot={snapshot} />;
}
