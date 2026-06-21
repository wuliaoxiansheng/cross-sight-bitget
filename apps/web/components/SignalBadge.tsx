import type { OpportunityScanItem } from "../lib/api";
import { statusLabel, statusTone } from "../lib/api";

export function SignalBadge({ item, large = false }: { item: OpportunityScanItem; large?: boolean }) {
  const tone = statusTone(item);
  return <span className={`signal-badge signal-${tone} ${large ? "signal-large" : ""}`}>{statusLabel(item)}</span>;
}

