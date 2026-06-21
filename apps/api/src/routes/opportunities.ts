import type { FastifyInstance } from "fastify";
import { config } from "../config/env.js";
import { WATCHLIST } from "../data/pairs.js";
import { evaluateBasisOpportunity } from "../services/basisEngine.js";
import { BitgetClient } from "../services/bitgetClient.js";

type LiveQuery = {
  pairId?: string;
  notionalUsd?: string;
};

export async function opportunityRoutes(app: FastifyInstance) {
  const bitget = new BitgetClient();

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

