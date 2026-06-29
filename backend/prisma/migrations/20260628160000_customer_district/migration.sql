-- District on customer ship-to and saved addresses (from pincode lookup).

ALTER TABLE "Customer" ADD COLUMN "district" TEXT;
ALTER TABLE "CustomerAddress" ADD COLUMN "district" TEXT;
