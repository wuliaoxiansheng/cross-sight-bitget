import type { FastifyInstance } from "fastify";
import { config } from "../config/env.js";
import { WATCHLIST } from "../data/pairs.js";
import { evaluateBasisOpportunity } from "../services/basisEngine.js";
import { BitgetClient } from "../services/bitgetClient.js";
import { buildPaperTradePreview } from "../services/paperTrading.js";
import { requireApiToken } from "./opportunities.js";

type PreviewQuery = {
  pairId?: string;
  notionalUsd?: string;
  balance?: string;
};

export async function paperTradeRoutes(app: FastifyInstance) {
  const bitget = new BitgetClient();

  app.get("/paper-trades", async () => {
    return {
      data: [],
      message: "Paper trade persistence is scaffolded in Prisma; the MVP route currently returns live previews."
    };
  });

  app.get<{ Querystring: PreviewQuery }>(
    "/paper-trades/preview",
    { preHandler: requireApiToken },
    async (request) => {
    const pairId = request.query.pairId ?? WATCHLIST[0]?.id;
    const pair = WATCHLIST.find((item) => item.id === pairId && item.enabled);

    if (!pair) {
      return {
        error: "PAIR_NOT_FOUND",
        message: `No enabled market pair found for ${pairId}`
      };
    }

    const notionalUsd = Number(request.query.notionalUsd ?? config.defaultNotionalUsd);
    const startingBalance = Number(request.query.balance ?? 10_000);

    const [spotTicker, spotBook, futuresTicker, futuresBook, funding] = await Promise.all([
      bitget.getSpotTicker(pair.spotSymbol),
      bitget.getSpotOrderBook(pair.spotSymbol),
      bitget.getFuturesTicker(pair.futuresSymbol, pair.productType),
      bitget.getFuturesOrderBook(pair.futuresSymbol, pair.productType),
      bitget.getCurrentFundingRate(pair.futuresSymbol, pair.productType)
    ]);

    const evaluation = evaluateBasisOpportunity({
      pair,
      notionalUsd: Number.isFinite(notionalUsd) ? notionalUsd : config.defaultNotionalUsd,
      spotTicker,
      spotBook,
      futuresTicker,
      futuresBook,
      funding
    });

    return {
      data: buildPaperTradePreview(evaluation, Number.isFinite(startingBalance) ? startingBalance : 10_000),
      evaluation
    };
  });
}

