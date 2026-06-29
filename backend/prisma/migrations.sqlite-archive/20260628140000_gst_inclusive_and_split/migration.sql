-- GST inclusive pricing toggle + CGST/SGST/IGST split fields

-- CompanyProfile
ALTER TABLE "CompanyProfile" ADD COLUMN "pricingIncludesGst" BOOLEAN NOT NULL DEFAULT false;

-- Invoice header
ALTER TABLE "Invoice" ADD COLUMN "cgstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "sgstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "igstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "taxKind" TEXT NOT NULL DEFAULT 'intra';
ALTER TABLE "Invoice" ADD COLUMN "placeOfSupplyState" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "sellerState" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "pricingInclusive" BOOLEAN NOT NULL DEFAULT false;

-- InvoiceItem lines
ALTER TABLE "InvoiceItem" ADD COLUMN "taxableValue" DOUBLE PRECISION;
ALTER TABLE "InvoiceItem" ADD COLUMN "cgstAmount" DOUBLE PRECISION;
ALTER TABLE "InvoiceItem" ADD COLUMN "sgstAmount" DOUBLE PRECISION;
ALTER TABLE "InvoiceItem" ADD COLUMN "igstAmount" DOUBLE PRECISION;

-- Quote header
ALTER TABLE "Quote" ADD COLUMN "cgstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN "sgstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN "igstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN "taxKind" TEXT NOT NULL DEFAULT 'intra';
ALTER TABLE "Quote" ADD COLUMN "placeOfSupplyState" TEXT;
ALTER TABLE "Quote" ADD COLUMN "sellerState" TEXT;
ALTER TABLE "Quote" ADD COLUMN "pricingInclusive" BOOLEAN NOT NULL DEFAULT false;

-- QuoteItem lines
ALTER TABLE "QuoteItem" ADD COLUMN "taxableValue" DOUBLE PRECISION;
ALTER TABLE "QuoteItem" ADD COLUMN "gstRate" DOUBLE PRECISION;
ALTER TABLE "QuoteItem" ADD COLUMN "cgstAmount" DOUBLE PRECISION;
ALTER TABLE "QuoteItem" ADD COLUMN "sgstAmount" DOUBLE PRECISION;
ALTER TABLE "QuoteItem" ADD COLUMN "igstAmount" DOUBLE PRECISION;

-- SalesOrder header
ALTER TABLE "SalesOrder" ADD COLUMN "cgstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrder" ADD COLUMN "sgstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrder" ADD COLUMN "igstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrder" ADD COLUMN "taxKind" TEXT NOT NULL DEFAULT 'intra';
ALTER TABLE "SalesOrder" ADD COLUMN "placeOfSupplyState" TEXT;
ALTER TABLE "SalesOrder" ADD COLUMN "sellerState" TEXT;
ALTER TABLE "SalesOrder" ADD COLUMN "pricingInclusive" BOOLEAN NOT NULL DEFAULT false;

-- SalesOrderItem lines
ALTER TABLE "SalesOrderItem" ADD COLUMN "taxableValue" DOUBLE PRECISION;
ALTER TABLE "SalesOrderItem" ADD COLUMN "gstRate" DOUBLE PRECISION;
ALTER TABLE "SalesOrderItem" ADD COLUMN "cgstAmount" DOUBLE PRECISION;
ALTER TABLE "SalesOrderItem" ADD COLUMN "sgstAmount" DOUBLE PRECISION;
ALTER TABLE "SalesOrderItem" ADD COLUMN "igstAmount" DOUBLE PRECISION;

-- CreditNote header
ALTER TABLE "CreditNote" ADD COLUMN "cgstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "CreditNote" ADD COLUMN "sgstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "CreditNote" ADD COLUMN "igstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "CreditNote" ADD COLUMN "taxKind" TEXT NOT NULL DEFAULT 'intra';
ALTER TABLE "CreditNote" ADD COLUMN "placeOfSupplyState" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN "sellerState" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN "pricingInclusive" BOOLEAN NOT NULL DEFAULT false;

-- CreditNoteItem lines
ALTER TABLE "CreditNoteItem" ADD COLUMN "taxableValue" DOUBLE PRECISION;
ALTER TABLE "CreditNoteItem" ADD COLUMN "cgstAmount" DOUBLE PRECISION;
ALTER TABLE "CreditNoteItem" ADD COLUMN "sgstAmount" DOUBLE PRECISION;
ALTER TABLE "CreditNoteItem" ADD COLUMN "igstAmount" DOUBLE PRECISION;

-- Backfill existing documents: treat as exclusive pricing, intra-state CGST+SGST split
UPDATE "Invoice" SET
  "cgstTotal" = ROUND("tax" / 2.0, 2),
  "sgstTotal" = "tax" - ROUND("tax" / 2.0, 2),
  "igstTotal" = 0,
  "taxKind" = 'intra',
  "pricingInclusive" = false
WHERE "tax" > 0;

UPDATE "InvoiceItem" SET
  "taxableValue" = "amount",
  "cgstAmount" = CASE WHEN COALESCE("taxAmount", 0) > 0 THEN ROUND(COALESCE("taxAmount", 0) / 2.0, 2) ELSE 0 END,
  "sgstAmount" = CASE WHEN COALESCE("taxAmount", 0) > 0 THEN COALESCE("taxAmount", 0) - ROUND(COALESCE("taxAmount", 0) / 2.0, 2) ELSE 0 END,
  "igstAmount" = 0
WHERE "amount" IS NOT NULL;

UPDATE "Quote" SET
  "cgstTotal" = ROUND("tax" / 2.0, 2),
  "sgstTotal" = "tax" - ROUND("tax" / 2.0, 2),
  "igstTotal" = 0,
  "taxKind" = 'intra',
  "pricingInclusive" = false
WHERE "tax" > 0;

UPDATE "QuoteItem" SET
  "taxableValue" = "amount"
WHERE "amount" IS NOT NULL;

UPDATE "SalesOrder" SET
  "cgstTotal" = ROUND("tax" / 2.0, 2),
  "sgstTotal" = "tax" - ROUND("tax" / 2.0, 2),
  "igstTotal" = 0,
  "taxKind" = 'intra',
  "pricingInclusive" = false
WHERE "tax" > 0;

UPDATE "SalesOrderItem" SET
  "taxableValue" = "amount"
WHERE "amount" IS NOT NULL;

UPDATE "CreditNote" SET
  "cgstTotal" = ROUND("tax" / 2.0, 2),
  "sgstTotal" = "tax" - ROUND("tax" / 2.0, 2),
  "igstTotal" = 0,
  "taxKind" = 'intra',
  "pricingInclusive" = false
WHERE "tax" > 0;

UPDATE "CreditNoteItem" SET
  "taxableValue" = "amount",
  "cgstAmount" = CASE WHEN COALESCE("taxAmount", 0) > 0 THEN ROUND(COALESCE("taxAmount", 0) / 2.0, 2) ELSE 0 END,
  "sgstAmount" = CASE WHEN COALESCE("taxAmount", 0) > 0 THEN COALESCE("taxAmount", 0) - ROUND(COALESCE("taxAmount", 0) / 2.0, 2) ELSE 0 END,
  "igstAmount" = 0
WHERE "amount" IS NOT NULL;
