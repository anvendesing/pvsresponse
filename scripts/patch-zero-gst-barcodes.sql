-- Zero GST for retail barcodes (salt, books, digester powder, 30kg rice bags, etc.)
-- Variants are matched by barcode; parent Product.gstRate is set to 0 only when
-- every variant of that product is included in this patch.

BEGIN;

-- ── Variants (barcode = retail scan code) ───────────────────────────────────
UPDATE "ProductVariant"
SET "gstRate" = 0, "updatedAt" = NOW()
WHERE barcode IN (
  'B1300', 'B1301', 'B1302',
  'SM1007', 'SM1008', 'SM1002', 'SM1003', 'SM1004', 'SM935',
  'DH348', 'DH349', 'DH350',
  'RC183', 'RC184',
  'CH261'
);

-- ── Parent products (only where ALL variants are in the list above) ─────────
UPDATE "Product"
SET "gstRate" = 0, "updatedAt" = NOW()
WHERE sku IN (
  'BK01',   -- B1300
  'BK02',   -- B1301
  'SMFT',   -- B1302
  'BKSL',   -- SM1007, SM1008
  'DPJG',   -- DH348, DH349
  'LEJG',   -- DH350
  'KWDP',   -- CH261
  'RCSL',   -- SM935
  'SESL'    -- SM1002, SM1003
);

-- FRPL / FRUP: only the 30kg variant is 0% — parent stays 5% (other packs remain 5%).
-- RCSC: only SM1004 variant patched — parent unchanged (RCSC-1KG-01 is a separate line).

COMMIT;

-- Verification
SELECT v.barcode, v.sku, v."gstRate" AS variant_gst, p.sku AS parent_sku, p."gstRate" AS parent_gst
FROM "ProductVariant" v
JOIN "Product" p ON p.id = v."productId"
WHERE v.barcode IN (
  'B1300', 'B1301', 'B1302',
  'SM1007', 'SM1008', 'SM1002', 'SM1003', 'SM1004', 'SM935',
  'DH348', 'DH349', 'DH350',
  'RC183', 'RC184',
  'CH261'
)
ORDER BY v.barcode;
