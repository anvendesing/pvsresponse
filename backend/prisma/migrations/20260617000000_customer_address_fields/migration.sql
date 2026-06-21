-- Structured customer address for address slips and courier posting.
ALTER TABLE "Customer" ADD COLUMN "addressLine" TEXT;
ALTER TABLE "Customer" ADD COLUMN "state" TEXT;
ALTER TABLE "Customer" ADD COLUMN "pincode" TEXT;
