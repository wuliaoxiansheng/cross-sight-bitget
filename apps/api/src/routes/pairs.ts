import type { FastifyInstance } from "fastify";
import { WATCHLIST } from "../data/pairs.js";

export async function pairRoutes(app: FastifyInstance) {
  app.get("/pairs", async () => {
    return {
      data: WATCHLIST
    };
  });
}

