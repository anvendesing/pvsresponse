-- PaymentIntent + PaymentGatewayConfig for Razorpay storefront checkout.

CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gateway" TEXT NOT NULL,
    "gatewayOrderId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'created',
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "cartSnapshot" TEXT NOT NULL,
    "salesOrderId" TEXT,
    "gatewayPaymentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "PaymentIntent_gatewayOrderId_key" ON "PaymentIntent"("gatewayOrderId");
CREATE INDEX "PaymentIntent_email_idx" ON "PaymentIntent"("email");
CREATE INDEX "PaymentIntent_status_idx" ON "PaymentIntent"("status");

CREATE TABLE "PaymentGatewayConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gateway" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'test',
    "keyId" TEXT,
    "keySecret" TEXT,
    "webhookSecret" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "PaymentGatewayConfig_gateway_key" ON "PaymentGatewayConfig"("gateway");

-- CustomerPayment gateway trace columns
ALTER TABLE "CustomerPayment" ADD COLUMN "gateway" TEXT;
ALTER TABLE "CustomerPayment" ADD COLUMN "gatewayPaymentId" TEXT;
ALTER TABLE "CustomerPayment" ADD COLUMN "gatewayOrderId" TEXT;
