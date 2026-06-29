-- Phone OTP auth: CustomerAccount phone identity, address book, OTP tokens, SMS config.

-- Rebuild CustomerAccount (SQLite cannot drop unique on email in-place).
CREATE TABLE "CustomerAccount_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "phoneVerifiedAt" DATETIME,
    "passwordHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "CustomerAccount_new" ("id", "customerId", "email", "phone", "phoneVerifiedAt", "passwordHash", "createdAt", "updatedAt")
SELECT ca."id", ca."customerId", ca."email", c."contact", NULL, ca."passwordHash", ca."createdAt", ca."updatedAt"
FROM "CustomerAccount" ca
JOIN "Customer" c ON c."id" = ca."customerId";

DROP TABLE "CustomerAccount";
ALTER TABLE "CustomerAccount_new" RENAME TO "CustomerAccount";

CREATE UNIQUE INDEX "CustomerAccount_customerId_key" ON "CustomerAccount"("customerId");
CREATE UNIQUE INDEX "CustomerAccount_phone_key" ON "CustomerAccount"("phone");
CREATE INDEX "CustomerAccount_email_idx" ON "CustomerAccount"("email");
CREATE INDEX "CustomerAccount_phone_idx" ON "CustomerAccount"("phone");

-- PaymentIntent: email optional for phone-first checkout.
CREATE TABLE "PaymentIntent_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gateway" TEXT NOT NULL,
    "gatewayOrderId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'created',
    "email" TEXT,
    "phone" TEXT,
    "cartSnapshot" TEXT NOT NULL,
    "salesOrderId" TEXT,
    "gatewayPaymentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "PaymentIntent_new" SELECT * FROM "PaymentIntent";
DROP TABLE "PaymentIntent";
ALTER TABLE "PaymentIntent_new" RENAME TO "PaymentIntent";

CREATE UNIQUE INDEX "PaymentIntent_gatewayOrderId_key" ON "PaymentIntent"("gatewayOrderId");
CREATE INDEX "PaymentIntent_email_idx" ON "PaymentIntent"("email");
CREATE INDEX "PaymentIntent_status_idx" ON "PaymentIntent"("status");

CREATE TABLE "CustomerAddress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "label" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "pincode" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CustomerAddress_customerId_idx" ON "CustomerAddress"("customerId");

CREATE TABLE "OtpToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "OtpToken_phone_purpose_expiresAt_idx" ON "OtpToken"("phone", "purpose", "expiresAt");

CREATE TABLE "SmsProviderConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "provider" TEXT NOT NULL DEFAULT 'smsidea',
    "mode" TEXT NOT NULL DEFAULT 'test',
    "username" TEXT,
    "password" TEXT,
    "senderId" TEXT,
    "templateId" TEXT,
    "templateText" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "DevOtpLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "DevOtpLog_phone_createdAt_idx" ON "DevOtpLog"("phone", "createdAt");
