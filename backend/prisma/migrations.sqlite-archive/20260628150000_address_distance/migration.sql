-- Persist dispatch distance on customer ship-to and saved addresses (computed on save).

ALTER TABLE "Customer" ADD COLUMN "distanceKm" REAL;
ALTER TABLE "Customer" ADD COLUMN "dispatchPincode" TEXT;

ALTER TABLE "CustomerAddress" ADD COLUMN "distanceKm" REAL;
ALTER TABLE "CustomerAddress" ADD COLUMN "dispatchPincode" TEXT;
