import type { FastifyInstance } from "fastify";
import { WATCHLIST } from "../data/pairs.js";
import { BitgetClient } from "../services/bitgetClient.js";
import { discoverRTokenPairs } from "../services/rtokenDiscovery.js";

export async function pairRoutes(app: FastifyInstance) {
  const bitget = new BitgetClient();

  app.get("/pairs", async () => {
    try {
      const discovered = await discoverRTokenPairs(bitget, 20);
      return {
        data: discovered.map((item) => ({
          ...item.pair,
          spotVolumeUsd: item.spotVolumeUsd,
          spotLastPrice: item.spotTicker.lastPrice,
          futuresLastPrice: item.futuresTicker.lastPrice
        }))
      };
    } catch {
      return {
        data: WATCHLIST
      };
    }
  });
}
