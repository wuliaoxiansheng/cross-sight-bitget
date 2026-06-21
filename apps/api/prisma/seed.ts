import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.marketPair.upsert({
    where: { id: "rspcx_spcx_perp" },
    update: {},
    create: {
      id: "rspcx_spcx_perp",
      name: "rSPCX spot / SPCX USDT perpetual",
      spotSymbol: "RSPCXUSDT",
      futuresSymbol: "SPCXUSDT",
      productType: "USDT-FUTURES",
      spotFeeRate: "0.001",
      futuresFeeRate: "0.0006",
      maxNotionalUsd: "10000",
      enabled: true
    }
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

