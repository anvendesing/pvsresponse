/**
 * Seed ShiprocketConfig from env vars (optional dev helper).
 *
 *   cd backend && npx tsx src/scripts/seed-shiprocket-config.ts
 */
import { db } from "../db.js";

async function main() {
  const email = process.env.SHIPROCKET_EMAIL?.trim();
  const password = process.env.SHIPROCKET_PASSWORD?.trim();
  const pickupPincode = process.env.SHIPROCKET_PICKUP_PINCODE?.trim() ?? null;

  if (!email || !password) {
    console.error("Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD in backend/.env first.");
    process.exit(1);
  }

  const row = await db.shiprocketConfig.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      email,
      password,
      pickupPincode,
      active: true,
    },
    update: {
      email,
      password,
      pickupPincode,
      active: true,
    },
  });

  console.log(`Shiprocket config upserted (active=${row.active}, pickup=${row.pickupPincode ?? "default"}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
