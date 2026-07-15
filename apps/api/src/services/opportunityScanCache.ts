import { config } from "../config/env.js";
import type { CrossVenueOpportunityScan, OpportunityScan, OpportunitySnapshot } from "../types/market.js";
import { BitgetClient } from "./bitgetClient.js";
import { scanCrossVenueOpportunities } from "./crossVenueScanner.js";
import { feishuOpportunityNotifier } from "./feishuNotifier.js";
import { HyperliquidClient } from "./hyperliquidClient.js";
import { scanRTokenOpportunities } from "./opportunityScanner.js";

type Subscriber = (snapshot: OpportunitySnapshot) => void;

const SCAN_INTERVAL_MS = 300_000;
const STALE_AFTER_MS = 900_000;
const DEFAULT_LIMIT: number | null = null;

export class OpportunityScanCache {
  private latestScan: OpportunityScan | null = null;
  private latestCrossVenueScan: CrossVenueOpportunityScan | null = null;
  private scanning = false;
  private startedAt: string | null = null;
  private completedAt: string | null = null;
  private nextRunAt: string | null = null;
  private lastError: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly subscribers = new Set<Subscriber>();

  constructor(
    private readonly bitget = new BitgetClient(),
    private readonly hyperliquid = new HyperliquidClient(),
    private readonly intervalMs = SCAN_INTERVAL_MS,
    private readonly limit: number | null = DEFAULT_LIMIT
  ) {}

  start() {
    if (this.timer) return;

    void this.runOnce();
    this.timer = setInterval(() => {
      if (!this.scanning) {
        void this.runOnce();
      }
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getSnapshot(): OpportunitySnapshot {
    const isStale =
      Boolean(this.completedAt) && Date.now() - new Date(this.completedAt as string).getTime() > STALE_AFTER_MS;

    return {
      status: this.lastError && !this.latestScan && !this.latestCrossVenueScan
        ? "error"
        : this.scanning
          ? "scanning"
          : this.latestScan || this.latestCrossVenueScan
            ? (isStale ? "stale" : "ready")
            : "warming",
      latestScan: this.latestScan,
      crossVenueScan: this.latestCrossVenueScan,
      scanning: this.scanning,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      nextRunAt: this.nextRunAt,
      lastError: this.lastError,
      intervalMs: this.intervalMs,
      limit: this.limit
    };
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.getSnapshot());

    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  async runOnce(): Promise<OpportunitySnapshot> {
    if (this.scanning) return this.getSnapshot();

    this.scanning = true;
    this.startedAt = new Date().toISOString();
    this.nextRunAt = null;
    this.emit();

    try {
      const [rtokenResult, crossVenueResult] = await Promise.allSettled([
        scanRTokenOpportunities({
          bitget: this.bitget,
          limit: this.limit,
          notionalUsd: config.defaultNotionalUsd
        }),
        scanCrossVenueOpportunities({
          bitget: this.bitget,
          hyperliquid: this.hyperliquid,
          notionalUsd: config.defaultNotionalUsd
        })
      ]);
      const errors: string[] = [];

      if (rtokenResult.status === "fulfilled") {
        this.latestScan = rtokenResult.value;
        void feishuOpportunityNotifier.notifyOpenOpportunities(this.latestScan).catch((error) => {
          console.error("Failed to send Feishu RToken opportunity alert", error);
        });
      } else {
        errors.push(`RToken: ${rtokenResult.reason instanceof Error ? rtokenResult.reason.message : String(rtokenResult.reason)}`);
      }

      if (crossVenueResult.status === "fulfilled") {
        this.latestCrossVenueScan = crossVenueResult.value;
        void feishuOpportunityNotifier.notifyCrossVenueOpportunities(this.latestCrossVenueScan).catch((error) => {
          console.error("Failed to send Feishu cross-venue opportunity alert", error);
        });
      } else {
        errors.push(`Cross-venue: ${crossVenueResult.reason instanceof Error ? crossVenueResult.reason.message : String(crossVenueResult.reason)}`);
      }

      if (rtokenResult.status === "rejected" && crossVenueResult.status === "rejected") {
        throw new Error(errors.join("; "));
      }
      this.completedAt = new Date().toISOString();
      this.lastError = errors.length > 0 ? errors.join("; ") : null;
      this.nextRunAt = new Date(Date.now() + this.intervalMs).toISOString();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "Unknown scanner error";
      this.nextRunAt = new Date(Date.now() + this.intervalMs).toISOString();
    } finally {
      this.scanning = false;
      this.emit();
    }

    return this.getSnapshot();
  }

  private emit() {
    const snapshot = this.getSnapshot();
    for (const subscriber of this.subscribers) {
      subscriber(snapshot);
    }
  }
}

export const opportunityScanCache = new OpportunityScanCache();
