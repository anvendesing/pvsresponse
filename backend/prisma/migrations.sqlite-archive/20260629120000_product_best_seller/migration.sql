-- Add storefront "Best Selling Products" feature flag on Product.
ALTER TABLE "Product" ADD COLUMN "bestSellerEnabled" BOOLEAN NOT NULL DEFAULT false;
