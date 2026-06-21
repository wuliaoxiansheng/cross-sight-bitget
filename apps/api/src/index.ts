import cors from "@fastify/cors";
import Fastify from "fastify";
import { config } from "./config/env.js";
import { healthRoutes } from "./routes/health.js";
import { opportunityRoutes } from "./routes/opportunities.js";
import { pairRoutes } from "./routes/pairs.js";
import { paperTradeRoutes } from "./routes/paperTrades.js";

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: config.corsOrigin
});

await app.register(healthRoutes);
await app.register(pairRoutes);
await app.register(opportunityRoutes);
await app.register(paperTradeRoutes);

try {
  await app.listen({
    port: config.port,
    host: "0.0.0.0"
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

