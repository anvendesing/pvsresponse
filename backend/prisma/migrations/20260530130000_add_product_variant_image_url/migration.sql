-- ProductVariant.imageUrl was added to schema without a prior migration.
ALTER TABLE "ProductVariant" ADD COLUMN "imageUrl" TEXT;
