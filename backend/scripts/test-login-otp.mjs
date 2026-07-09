/**
 * Test storefront login OTP via SMSidea.
 * Usage: node scripts/test-login-otp.mjs <10-digit-phone>
 * Example: node scripts/test-login-otp.mjs 9876543210
 */
import { PrismaClient } from "@prisma/client";

const phone = process.argv[2]?.replace(/\D/g, "").slice(-10);
if (!phone || !/^[6-9][0-9]{9}$/.test(phone)) {
  console.error("Usage: node scripts/test-login-otp.mjs <10-digit-mobile>");
  process.exit(1);
}

const API = process.env.API_BASE ?? "http://127.0.0.1:4000/v1";

console.log(`Testing login OTP for ${phone} via ${API}...\n`);

const sendRes = await fetch(`${API}/storefront-auth/otp/send`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ phone, purpose: "login" }),
});
const sendBody = await sendRes.json();
console.log("POST /storefront-auth/otp/send");
console.log("  Status:", sendRes.status);
console.log("  Response:", JSON.stringify(sendBody, null, 2));

if (!sendRes.ok) {
  process.exit(1);
}

if (sendBody.devOtp) {
  console.log("\n[dev mode] OTP returned in response — SMS not sent (credentials missing/inactive).");
  console.log("  Code:", sendBody.devOtp);
} else {
  console.log("\nSMS dispatched via SMSidea. Check the phone for the OTP.");
}

// Show latest dev log entry if any
const db = new PrismaClient();
const log = await db.devOtpLog.findFirst({
  where: { phone: { endsWith: phone.slice(-10) } },
  orderBy: { createdAt: "desc" },
});
if (log) {
  console.log("\nLatest devOtpLog:", log.code, "at", log.createdAt.toISOString());
}
await db.$disconnect();
