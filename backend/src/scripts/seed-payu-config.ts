/**
 * Seed PayU PaymentGatewayConfig from env vars (optional dev helper).
 *
 *   cd backend && npx tsx src/scripts/seed-payu-config.ts
 *
 * Reads PAYU_MERCHANT_KEY, PAYU_SALT, PAYU_MODE from .env
 */
import { db } from "../db.js";

async function main() {
  const keyId = process.env.PAYU_MERCHANT_KEY?.trim();
  const keySecret = process.env.PAYU_SALT?.trim();
  const modeEnv = process.env.PAYU_MODE?.trim().toLowerCase();

  if (!keyId || !keySecret) {
    console.error("Set PAYU_MERCHANT_KEY and PAYU_SALT in backend/.env first.");
    process.exit(1);
  }

  const row = await db.paymentGatewayConfig.upsert({
    where: { gateway: "payu" },
    create: {
      gateway: "payu",
      mode: modeEnv === "live" ? "live" : "test",
      keyId,
      keySecret,
      active: true,
    },
    update: {
      mode: modeEnv === "live" ? "live" : "test",
      keyId,
      keySecret,
      active: true,
    },
  });

  console.log(`PayU config upserted (${row.mode}, active=${row.active}).`);
  console.log("Tip: deactivate Razorpay in Settings if PayU should be the sole checkout gateway.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
