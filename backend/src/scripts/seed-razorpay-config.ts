/**
 * Seed Razorpay PaymentGatewayConfig from env vars (optional dev helper).
 *
 *   cd backend && npx tsx src/scripts/seed-razorpay-config.ts
 *
 * Reads RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET from .env
 */
import { db } from "../db.js";

async function main() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? null;

  if (!keyId || !keySecret) {
    console.error("Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend/.env first.");
    process.exit(1);
  }

  const row = await db.paymentGatewayConfig.upsert({
    where: { gateway: "razorpay" },
    create: {
      gateway: "razorpay",
      mode: keyId.startsWith("rzp_live_") ? "live" : "test",
      keyId,
      keySecret,
      webhookSecret,
      active: true,
    },
    update: {
      mode: keyId.startsWith("rzp_live_") ? "live" : "test",
      keyId,
      keySecret,
      webhookSecret,
      active: true,
    },
  });

  console.log(`Razorpay config upserted (${row.mode}, active=${row.active}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
