-- Shiprocket credentials (admin UI); PayU uses existing PaymentGatewayConfig rows.
CREATE TABLE "ShiprocketConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "email" TEXT,
    "password" TEXT,
    "pickupPincode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
