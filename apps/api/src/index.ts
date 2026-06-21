import cors from "@fastify/cors";
import Fastify from "fastify";
import { config } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { healthRoutes } from "./routes/health.js";
import { opportunityRoutes } from "./routes/opportunities.js";
import { pairRoutes } from "./routes/pairs.js";
import { paperTradeRoutes } from "./routes/paperTrades.js";
import { opportunityScanCache } from "./services/opportunityScanCache.js";

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

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`Received ${signal}, shutting down gracefully...`);
  try {
    opportunityScanCache.stop();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

try {
  await app.listen({
    port: config.port,
    host: "0.0.0.0"
  });
  opportunityScanCache.start();
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
