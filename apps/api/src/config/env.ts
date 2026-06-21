export type AppConfig = {
  port: number;
  databaseUrl: string;
  bitgetBaseUrl: string;
  corsOrigin: string;
  defaultNotionalUsd: number;
  openEdgeThreshold: number;
  fundingPeriodsToPrice: number;
};

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric env var ${name}: ${value}`);
  }

  return parsed;
}

export const config: AppConfig = {
  port: numberFromEnv("PORT", 4000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  bitgetBaseUrl: process.env.BITGET_BASE_URL ?? "https://api.bitget.com",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  defaultNotionalUsd: numberFromEnv("DEFAULT_NOTIONAL_USD", 5000),
  openEdgeThreshold: numberFromEnv("OPEN_EDGE_THRESHOLD", 0.003),
  fundingPeriodsToPrice: numberFromEnv("FUNDING_PERIODS_TO_PRICE", 1)
};

