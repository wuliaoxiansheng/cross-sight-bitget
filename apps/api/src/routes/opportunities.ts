import type { FastifyInstance } from "fastify";
import { config } from "../config/env.js";
import { WATCHLIST } from "../data/pairs.js";
import { evaluateBasisOpportunity } from "../services/basisEngine.js";
import { BitgetClient } from "../services/bitgetClient.js";
import { opportunityScanCache } from "../services/opportunityScanCache.js";
import { scanRTokenOpportunities } from "../services/opportunityScanner.js";

type LiveQuery = {
  pairId?: string;
  notionalUsd?: string;
};

type LiveAllQuery = {
  limit?: string;
  notionalUsd?: string;
};

export async function opportunityRoutes(app: FastifyInstance) {
  const bitget = new BitgetClient();

  app.get("/opportunities/snapshot", async () => {
    return {
      data: opportunityScanCache.getSnapshot()
    };
  });

  app.post("/opportunities/refresh", async () => {
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

  app.get<{ Querystring: LiveAllQuery }>("/opportunities/live-all", async (request) => {
    const limit = Number(request.query.limit ?? 100);
    const notionalUsd = Number(request.query.notionalUsd ?? config.defaultNotionalUsd);

    return {
      data: await scanRTokenOpportunities({
        bitget,
        limit: Number.isFinite(limit) ? limit : 12,
        notionalUsd: Number.isFinite(notionalUsd) ? notionalUsd : config.defaultNotionalUsd
      })
    };
  });

  app.get<{ Querystring: LiveQuery }>("/opportunities/live", async (request) => {
    const pairId = request.query.pairId ?? WATCHLIST[0]?.id;
    const pair = WATCHLIST.find((item) => item.id === pairId && item.enabled);

    if (!pair) {
      return {
        error: "PAIR_NOT_FOUND",
        message: `No enabled market pair found for ${pairId}`
      };
    }

    const notionalUsd = Number(request.query.notionalUsd ?? config.defaultNotionalUsd);
    const safeNotional = Number.isFinite(notionalUsd) ? notionalUsd : config.defaultNotionalUsd;

    const [spotTicker, spotBook, futuresTicker, futuresBook, funding] = await Promise.all([
      bitget.getSpotTicker(pair.spotSymbol),
      bitget.getSpotOrderBook(pair.spotSymbol),
      bitget.getFuturesTicker(pair.futuresSymbol, pair.productType),
      bitget.getFuturesOrderBook(pair.futuresSymbol, pair.productType),
      bitget.getCurrentFundingRate(pair.futuresSymbol, pair.productType)
    ]);

    const evaluation = evaluateBasisOpportunity({
      pair,
      notionalUsd: safeNotional,
      spotTicker,
      spotBook,
      futuresTicker,
      futuresBook,
      funding
    });

    return {
      data: evaluation,
      raw: {
        spotTicker,
        futuresTicker,
        funding
      }
    };
  });
}
