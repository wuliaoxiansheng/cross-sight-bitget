import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config/env.js";
import { WATCHLIST } from "../data/pairs.js";
import { evaluateBasisOpportunity } from "../services/basisEngine.js";
import { BitgetClient } from "../services/bitgetClient.js";
import { opportunityScanCache } from "../services/opportunityScanCache.js";
import { scanRTokenOpportunities } from "../services/opportunityScanner.js";
import { discoverRTokenPairs } from "../services/rtokenDiscovery.js";
import type { MarketPairConfig } from "../types/market.js";

type LiveQuery = {
  pairId?: string;
  spotSymbol?: string;
  futuresSymbol?: string;
  notionalUsd?: string;
};

type LiveAllQuery = {
  limit?: string;
  notionalUsd?: string;
};

function normalizeSymbol(value?: string): string | undefined {
  return value?.trim().toUpperCase() || undefined;
}

async function resolveLivePair(input: {
  bitget: BitgetClient;
  pairId?: string;
  spotSymbol?: string;
  futuresSymbol?: string;
}): Promise<MarketPairConfig | null> {
  const pairId = input.pairId?.trim().toLowerCase();
  const spotSymbol = normalizeSymbol(input.spotSymbol);
  const futuresSymbol = normalizeSymbol(input.futuresSymbol);
  const matches = (pair: MarketPairConfig) => {
    if (pairId && pair.id.toLowerCase() === pairId) return true;
    if (spotSymbol && futuresSymbol && pair.spotSymbol === spotSymbol && pair.futuresSymbol === futuresSymbol) {
      return true;
    }
    return false;
  };

  const staticPair = WATCHLIST.find((item) => item.enabled && matches(item));
  if (staticPair) return staticPair;

  const snapshotPair = opportunityScanCache.getSnapshot().latestScan?.items.find((item) => matches(item.pair))?.pair;
  if (snapshotPair) return snapshotPair;

  const discoveredPair = (await discoverRTokenPairs(input.bitget, { pinnedPairs: WATCHLIST })).find((item) =>
    matches(item.pair)
  );
  return discoveredPair?.pair ?? null;
}

// Optional shared-secret guard for the heavy Bitget-fanout endpoints. No-op when
// config.apiToken is empty (local dev default).
export async function requireApiToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!config.apiToken) return;
  if (request.headers["x-api-token"] !== config.apiToken) {
    await reply.code(401).send({ error: "UNAUTHORIZED", message: "Missing or invalid x-api-token." });
  }
}

// Throttle on-demand full scans so callers can't hammer Bitget (and risk an
// egress-IP ban). Shared across /refresh and /live-all; cached data is always
// available via /opportunities/snapshot without throttling.
let lastLiveScanAt = 0;
async function throttleLiveScan(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const now = Date.now();
  if (now - lastLiveScanAt < config.liveScanMinIntervalMs) {
    await reply.code(429).send({
      error: "RATE_LIMITED",
      message: `On-demand scans are limited to once per ${config.liveScanMinIntervalMs}ms. Use /opportunities/snapshot for cached results.`
    });
    return;
  }
  lastLiveScanAt = now;
}

export async function opportunityRoutes(app: FastifyInstance) {
  const bitget = new BitgetClient();

  app.get("/opportunities/snapshot", async () => {
    return {
      data: opportunityScanCache.getSnapshot()
    };
  });

  app.post("/opportunities/refresh", { preHandler: [requireApiToken, throttleLiveScan] }, async () => {
    return {
      data: await opportunityScanCache.runOnce()
    };
  });

  app.get("/opportunities/stream", async (_request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const send = (snapshot: ReturnType<typeof opportunityScanCache.getSnapshot>) => {
      reply.raw.write(`event: snapshot\n`);
      reply.raw.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    };

    const unsubscribe = opportunityScanCache.subscribe(send);
    const heartbeat = setInterval(() => {
      reply.raw.write(`event: ping\n`);
      reply.raw.write(`data: ${Date.now()}\n\n`);
    }, 15_000);

    _request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.get<{ Querystring: LiveAllQuery }>(
    "/opportunities/live-all",
    { preHandler: [requireApiToken, throttleLiveScan] },
    async (request) => {
      const limit = request.query.limit == null ? null : Number(request.query.limit);
      const notionalUsd = Number(request.query.notionalUsd ?? config.defaultNotionalUsd);

      return {
        data: await scanRTokenOpportunities({
          bitget,
          limit: limit == null || Number.isFinite(limit) ? limit : null,
          notionalUsd: Number.isFinite(notionalUsd) ? notionalUsd : config.defaultNotionalUsd
        })
      };
    }
  );

  app.get<{ Querystring: LiveQuery }>(
    "/opportunities/live",
    async (request) => {
      const pairId = request.query.pairId ?? WATCHLIST[0]?.id;
      const pair = await resolveLivePair({
        bitget,
        pairId,
        spotSymbol: request.query.spotSymbol,
        futuresSymbol: request.query.futuresSymbol
      });

      if (!pair) {
        return {
          error: "PAIR_NOT_FOUND",
          message: `No enabled market pair found for ${pairId ?? request.query.spotSymbol ?? "unknown"}`
        };
      }

      const notionalUsd = Number(request.query.notionalUsd ?? config.defaultNotionalUsd);
      const safeNotional = Number.isFinite(notionalUsd) ? notionalUsd : config.defaultNotionalUsd;

      const [spotTicker, spotBook, futuresTicker, futuresBook, funding, fundingHistory] = await Promise.all([
        bitget.getSpotTicker(pair.spotSymbol),
        bitget.getSpotOrderBook(pair.spotSymbol),
        bitget.getFuturesTicker(pair.futuresSymbol, pair.productType),
        bitget.getFuturesOrderBook(pair.futuresSymbol, pair.productType),
        bitget.getCurrentFundingRate(pair.futuresSymbol, pair.productType),
        bitget.getFundingRateHistory(pair.futuresSymbol, pair.productType, 10).catch(() => [])
      ]);

      const evaluation = evaluateBasisOpportunity({
        pair,
        notionalUsd: safeNotional,
        spotTicker,
        spotBook,
        futuresTicker,
        futuresBook,
        funding,
        fundingHistory
      });

      return {
        data: evaluation,
        raw: {
          spotTicker,
          futuresTicker,
          funding
        }
      };
    }
  );
}
