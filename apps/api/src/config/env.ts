import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type AppConfig = {
  port: number;
  databaseUrl: string;
  bitgetBaseUrl: string;
  corsOrigin: string;
  defaultNotionalUsd: number;
  openEdgeThreshold: number;
  fundingPeriodsToPrice: number;
  // Optional shared secret. When set, manual heavy endpoints
  // (/opportunities/refresh, /live-all, /paper-trades/preview) require a
  // matching `x-api-token` header. /opportunities/live stays browser-callable.
  apiToken: string;
  // Minimum spacing between on-demand full scans triggered over HTTP, to avoid
  // hammering Bitget (and getting the egress IP rate-limited/banned).
  liveScanMinIntervalMs: number;
  // Feishu bot webhook for OPEN opportunity alerts. Leave empty to disable.
  feishuWebhookUrl: string;
  // Keyword included in every message so Feishu custom keyword security passes.
  feishuKeyword: string;
  // Per-pair cooldown to avoid posting the same OPEN signal every scan.
  feishuNotifyCooldownMs: number;
  feishuNotifyMaxItems: number;
  // Reject order books whose best bid/ask diverges too far from the exchange
  // ticker. This catches stale or internally inconsistent RToken books.
  orderBookTickerMaxDeviation: number;
};

function loadEnvFiles() {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(moduleDir, "..", "..", "..", "..");
  const candidates = [
    resolve(repoRoot, ".env"),
    resolve(repoRoot, ".env.local"),
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), ".env.local")
  ];
  const seen = new Set<string>();

  for (const filePath of candidates) {
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) continue;

      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();
      if (!key || process.env[key] !== undefined) continue;

      process.env[key] = stripEnvQuotes(rawValue);
    }
  }
}

function stripEnvQuotes(value: string): string {
  const first = value.at(0);
  const last = value.at(-1);
  if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
    return value.slice(1, -1);
  }
  return value;
}

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric env var ${name}: ${value}`);
  }

  return parsed;
}

loadEnvFiles();

export const config: AppConfig = {
  port: numberFromEnv("PORT", 4000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  bitgetBaseUrl: process.env.BITGET_BASE_URL ?? "https://api.bitget.com",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  defaultNotionalUsd: numberFromEnv("DEFAULT_NOTIONAL_USD", 5000),
  openEdgeThreshold: numberFromEnv("OPEN_EDGE_THRESHOLD", 0.003),
  fundingPeriodsToPrice: numberFromEnv("FUNDING_PERIODS_TO_PRICE", 1),
  apiToken: process.env.API_TOKEN ?? "",
  liveScanMinIntervalMs: numberFromEnv("LIVE_SCAN_MIN_INTERVAL_MS", 10_000),
  feishuWebhookUrl: process.env.FEISHU_WEBHOOK_URL ?? "",
  feishuKeyword: process.env.FEISHU_KEYWORD ?? "美股",
  feishuNotifyCooldownMs: numberFromEnv("FEISHU_NOTIFY_COOLDOWN_MS", 1_800_000),
  feishuNotifyMaxItems: numberFromEnv("FEISHU_NOTIFY_MAX_ITEMS", 5),
  orderBookTickerMaxDeviation: numberFromEnv("ORDER_BOOK_TICKER_MAX_DEVIATION", 0.02)
};
