-- Per-product and per-variant flags for ecommerce vs price-list visibility.
ALTER TABLE "Product" ADD COLUMN "ecommerceEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Product" ADD COLUMN "priceListEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ProductVariant" ADD COLUMN "ecommerceEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ProductVariant" ADD COLUMN "priceListEnabled" BOOLEAN NOT NULL DEFAULT true;
