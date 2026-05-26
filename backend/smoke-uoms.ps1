# Smoke test for the UoM master and BOM uom validation.
#
# Verifies:
#  1. /uom-categories returns the 5 canonical categories
#  2. /uoms returns >= 27 canonical UoMs
#  3. POST /uoms/normalize maps "Kg" -> "kg", "Ltr" -> "L", "Nos" -> "pc"
#  4. POST /uoms/convert: 1 kg -> 1000 g; reject kg -> L (cross-category)
#  5. POST /products with uom="LTR" stores as canonical "L"
#  6. POST /boms rejects a BOM line whose uom is in a different
#     category than its component product (e.g. parent kg, line m)
#  7. POST /boms accepts and persists a same-category line uom

$ErrorActionPreference = "Stop"
$BASE = "http://localhost:4000/v1"

function FailIf([bool]$cond, [string]$msg) {
  if ($cond) { throw "FAIL: $msg" }
}

Write-Host "==> Login"
$login = Invoke-RestMethod -Uri "$BASE/auth/login" -Method POST -ContentType "application/json" -Body '{"username":"admin","password":"nova1234"}'
$H = @{ "Authorization" = "Bearer $($login.token)" }

Write-Host "==> 1. uom-categories"
$cats = Invoke-RestMethod -Uri "$BASE/uom-categories" -Method GET -Headers $H
FailIf ($cats.Count -ne 5) "Expected 5 UoM categories, got $($cats.Count)"
$catCodes = ($cats | ForEach-Object { $_.code } | Sort-Object) -join ","
FailIf ($catCodes -ne "length,time,unit,volume,weight") "Unexpected category codes: $catCodes"
Write-Host "    OK ($($cats.Count) categories: $catCodes)"

Write-Host "==> 2. uoms"
$uoms = Invoke-RestMethod -Uri "$BASE/uoms" -Method GET -Headers $H
FailIf ($uoms.Count -lt 27) "Expected at least 27 canonical UoMs, got $($uoms.Count)"
Write-Host "    OK ($($uoms.Count) UoMs)"
$refKg = $uoms | Where-Object { $_.code -eq "kg" }
FailIf (-not $refKg.isReference) "kg should be reference for weight"
$refL = $uoms | Where-Object { $_.code -eq "L" }
FailIf (-not $refL.isReference) "L should be reference for volume"

Write-Host "==> 3. normalize aliases"
$pairs = @(
  @{ input = "Kg"; expected = "kg" },
  @{ input = "KG"; expected = "kg" },
  @{ input = "Ltr"; expected = "L" },
  @{ input = "Litre"; expected = "L" },
  @{ input = "Nos"; expected = "pc" },
  @{ input = "Pcs"; expected = "pc" },
  @{ input = "Mtr"; expected = "m" },
  @{ input = "grams"; expected = "g" }
)
foreach ($p in $pairs) {
  $body = @{ input = $p.input } | ConvertTo-Json
  $resp = Invoke-RestMethod -Uri "$BASE/uoms/normalize" -Method POST -ContentType "application/json" -Headers $H -Body $body
  FailIf ($resp.code -ne $p.expected) "normalize($($p.input)) expected $($p.expected) got $($resp.code)"
  Write-Host "    OK $($p.input) -> $($resp.code)"
}

Write-Host "==> 4. unit conversion"
$conv = Invoke-RestMethod -Uri "$BASE/uoms/convert" -Method POST -ContentType "application/json" -Headers $H -Body (@{ qty = 1; from = "kg"; to = "g" } | ConvertTo-Json)
FailIf ([Math]::Abs($conv.result - 1000) -gt 0.0001) "1 kg -> g should be 1000, got $($conv.result)"
Write-Host "    OK 1 kg = $($conv.result) g"

$conv2 = Invoke-RestMethod -Uri "$BASE/uoms/convert" -Method POST -ContentType "application/json" -Headers $H -Body (@{ qty = 500; from = "mL"; to = "L" } | ConvertTo-Json)
FailIf ([Math]::Abs($conv2.result - 0.5) -gt 0.0001) "500 mL -> L should be 0.5, got $($conv2.result)"
Write-Host "    OK 500 mL = $($conv2.result) L"

# Cross-category should 400
$crossOk = $false
try {
  Invoke-RestMethod -Uri "$BASE/uoms/convert" -Method POST -ContentType "application/json" -Headers $H -Body (@{ qty = 1; from = "kg"; to = "L" } | ConvertTo-Json) | Out-Null
} catch {
  $crossOk = $true
}
FailIf (-not $crossOk) "Cross-category kg -> L conversion should be rejected"
Write-Host "    OK kg -> L rejected"

Write-Host "==> 5. POST /products auto-canonicalises uom"
# Random barcode/sku to avoid collisions across re-runs.
$tag = (Get-Date).Ticks.ToString().Substring(8)
$prodBody = @{
  sku = "TEST-UOM-$tag"
  name = "UoM smoke test product"
  type = "raw"
  uom = "LTR"  # legacy alias - server must store as "L"
  barcode = "BC-UOM-$tag"
  category = "test"
  hsn = "0000"
  costPrice = 10
  sellingPrice = 20
} | ConvertTo-Json
$created = Invoke-RestMethod -Uri "$BASE/products" -Method POST -ContentType "application/json" -Headers $H -Body $prodBody
FailIf ($created.uom -ne "L") "Product uom should be canonical 'L', got '$($created.uom)'"
Write-Host "    OK posted uom=LTR, stored as $($created.uom)"

Write-Host "==> 6. BOM cross-category line uom rejected"
# Find any non-test product with uom=kg and any with uom=m.
$products = Invoke-RestMethod -Uri "$BASE/products?limit=500" -Method GET -Headers $H
$kgProduct = $products | Where-Object { $_.uom -eq "kg" } | Select-Object -First 1
$pcProduct = $products | Where-Object { $_.uom -eq "pc" -and $_.id -ne $kgProduct.id } | Select-Object -First 1
FailIf (-not $kgProduct) "Need at least one product with uom=kg for the test"
FailIf (-not $pcProduct) "Need at least one product with uom=pc for the test"

$bomBad = @{
  productId = $kgProduct.id
  revision = "Rev-UOM-BAD-$tag"
  outputQty = 1
  active = $false
  items = @(
    @{
      productId = $pcProduct.id
      qty = 1
      uom = "kg"  # mismatch - pc-product can't be measured in kg
      scrapPct = 0
    }
  )
} | ConvertTo-Json -Depth 4

$rejected = $false
try {
  Invoke-RestMethod -Uri "$BASE/boms" -Method POST -ContentType "application/json" -Headers $H -Body $bomBad | Out-Null
} catch {
  $rejected = $true
  $errBody = $_.ErrorDetails.Message
  FailIf ($errBody -notmatch "uom_category_mismatch|same category") "Wrong rejection reason: $errBody"
}
FailIf (-not $rejected) "Cross-category BOM line should have been rejected"
Write-Host "    OK kg parent + pc-product line in kg rejected"

Write-Host "==> 7. BOM with same-category line uom accepted (kg -> g)"
# Take 2 distinct products with uom=kg.
$kgProducts = $products | Where-Object { $_.uom -eq "kg" }
FailIf ($kgProducts.Count -lt 2) "Need 2 kg-products for same-category test"
$kgParent = $kgProducts[0]
$kgChild = $kgProducts | Where-Object { $_.id -ne $kgParent.id } | Select-Object -First 1

$bomGood = @{
  productId = $kgParent.id
  revision = "Rev-UOM-OK-$tag"
  outputQty = 1
  active = $false
  items = @(
    @{
      productId = $kgChild.id
      qty = 500
      uom = "g"  # different unit, same category as kg -> OK
      scrapPct = 0
    }
  )
} | ConvertTo-Json -Depth 4

$ok = Invoke-RestMethod -Uri "$BASE/boms" -Method POST -ContentType "application/json" -Headers $H -Body $bomGood
FailIf ($ok.items[0].uom -ne "g") "BomItem.uom should be canonical 'g', got '$($ok.items[0].uom)'"
Write-Host "    OK kg-parent + kg-product line in g accepted (uom stored as $($ok.items[0].uom))"

# Cleanup
Invoke-RestMethod -Uri "$BASE/boms/$($ok.id)" -Method DELETE -Headers $H | Out-Null
Invoke-RestMethod -Uri "$BASE/products/$($created.id)" -Method DELETE -Headers $H | Out-Null

Write-Host ""
Write-Host "==> All UoM smoke checks passed."
