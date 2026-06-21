import { config } from "../config/env.js";
import type { OpportunityScan, OpportunitySnapshot } from "../types/market.js";
import { BitgetClient } from "./bitgetClient.js";
import { feishuOpportunityNotifier } from "./feishuNotifier.js";
import { scanRTokenOpportunities } from "./opportunityScanner.js";

type Subscriber = (snapshot: OpportunitySnapshot) => void;

const SCAN_INTERVAL_MS = 300_000;
const STALE_AFTER_MS = 900_000;
const DEFAULT_LIMIT: number | null = null;

export class OpportunityScanCache {
  private latestScan: OpportunityScan | null = null;
  private scanning = false;
  private startedAt: string | null = null;
  private completedAt: string | null = null;
  private nextRunAt: string | null = null;
  private lastError: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly subscribers = new Set<Subscriber>();

  constructor(
    private readonly bitget = new BitgetClient(),
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
      status: this.lastError && !this.latestScan ? "error" : this.scanning ? "scanning" : this.latestScan ? (isStale ? "stale" : "ready") : "warming",
      latestScan: this.latestScan,
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
      this.latestScan = await scanRTokenOpportunities({
        bitget: this.bitget,
        limit: this.limit,
        notionalUsd: config.defaultNotionalUsd
      });
      void feishuOpportunityNotifier.notifyOpenOpportunities(this.latestScan).catch((error) => {
        console.error("Failed to send Feishu opportunity alert", error);
      });
      this.completedAt = new Date().toISOString();
      this.lastError = null;
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
