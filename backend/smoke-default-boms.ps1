# Default-BOM-generation + variant-consumes-parent walker smoke test.
#
# Verifies:
#   1. POST /products/:id/generate-default-boms creates a packaging BOM
#      for each variant that does not already have one, consuming the
#      parent at qty = packSize.
#   2. Re-running the same call is idempotent (skips existing).
#   3. The BOM walker (used by /production-orders/:id/requirements)
#      no longer marks "variant BOM consumes parent product" as a cycle.
#
# Idempotent: cleans up any leftover DBOM- products at start.
$ErrorActionPreference = "Stop"
$base = "http://localhost:4000/v1"
$suffix = "{0:x}" -f (Get-Random)
function MakeHeaders { param([string]$tok) @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" } }
function Fail { param($m) Write-Host "FAIL: $m" -ForegroundColor Red; exit 1 }
function OK   { param($m) Write-Host "OK:   $m" -ForegroundColor Green }

$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType "application/json" -Body (@{ username = "admin"; password = "nova1234" } | ConvertTo-Json)
$h = MakeHeaders $login.token

Write-Host "--- Cleanup leftover DBOM- products ---" -ForegroundColor Cyan
try {
  $existing = Invoke-RestMethod -Method Get -Uri "$base/products?search=DBOM&limit=50" -Headers $h
  foreach ($p in $existing) {
    if ($p.sku -like "DBOM-*") {
      try { Invoke-RestMethod -Method Delete -Uri "$base/products/$($p.id)" -Headers $h | Out-Null } catch {}
    }
  }
} catch {}

Write-Host "`n--- Create parent (kg) with three variants (1 kg, 500 g, 100 g) ---" -ForegroundColor Cyan
$pSku  = "DBOM-PARENT-$suffix"
$v1Sku = "DBOM-V-1KG-$suffix"
$v2Sku = "DBOM-V-500G-$suffix"
$v3Sku = "DBOM-V-100G-$suffix"
$body = @{
  sku       = $pSku
  name      = "Smoke parent"
  type      = "raw"
  uom       = "kg"
  barcode   = "$pSku-BC"
  category  = "Test"
  hsn       = "0000"
  costPrice = 100
  sellingPrice = 0
  stockOnHand = 10
  variants = @(
    @{ sku = $v1Sku; barcode = "$v1Sku-BC"; size = "1 kg";  uom = "pc"; packSize = 1   }
    @{ sku = $v2Sku; barcode = "$v2Sku-BC"; size = "500 g"; uom = "pc"; packSize = 0.5 }
    @{ sku = $v3Sku; barcode = "$v3Sku-BC"; size = "100 g"; uom = "pc"; packSize = 0.1 }
  )
} | ConvertTo-Json -Depth 5
$parent = Invoke-RestMethod -Method Post -Uri "$base/products" -Headers $h -Body $body
if (-not $parent.id) { Fail "parent not created" }
OK "parent DBOM-PARENT created with 3 variants"

Write-Host "`n--- Generate default packaging BOMs ---" -ForegroundColor Cyan
$gen = Invoke-RestMethod -Method Post -Uri "$base/products/$($parent.id)/generate-default-boms" -Headers $h -Body "{}"
if ($gen.created.Count -ne 3) { Fail "expected 3 created, got $($gen.created.Count)" }
OK "3 default BOMs created"
foreach ($c in $gen.created) {
  Write-Host "  $($c.variantSku) -> $($c.consumed)"
}

# Verify each consume qty matches the variant's packSize.
$expected = @{ "$v1Sku" = 1.0; "$v2Sku" = 0.5; "$v3Sku" = 0.1 }
foreach ($c in $gen.created) {
  $exp = $expected[$c.variantSku]
  if ($null -eq $exp) { Fail "unexpected variant $($c.variantSku) in created list" }
  if ($c.consumed -notlike "$exp kg of $pSku*") { Fail "$($c.variantSku) expected $exp kg of $pSku, got '$($c.consumed)'" }
}
OK "consume qtys match variant packSize values"

Write-Host "`n--- Re-run is idempotent ---" -ForegroundColor Cyan
$gen2 = Invoke-RestMethod -Method Post -Uri "$base/products/$($parent.id)/generate-default-boms" -Headers $h -Body "{}"
if ($gen2.created.Count -ne 0) { Fail "expected 0 created on re-run, got $($gen2.created.Count)" }
if ($gen2.skipped.Count -ne 3) { Fail "expected 3 skipped on re-run, got $($gen2.skipped.Count)" }
OK "re-run created 0, skipped 3"

Write-Host "`n--- Walker: variant BOM consuming parent product is NOT a cycle ---" -ForegroundColor Cyan
# Look up the BOM for DBOM-V-100G and create a small MO to test the
# /requirements endpoint against the new walker.
$boms = Invoke-RestMethod -Method Get -Uri "$base/boms?productId=$($parent.id)" -Headers $h
$v100Bom = $boms | Where-Object { $_.variant -and $_.variant.sku -eq $v3Sku } | Select-Object -First 1
if (-not $v100Bom) { Fail "could not find $v3Sku BOM" }

$today = (Get-Date).ToString("yyyy-MM-dd")
$dueDate = (Get-Date).AddDays(2).ToString("yyyy-MM-dd")
$mo = Invoke-RestMethod -Method Post -Uri "$base/production-orders" -Headers $h -Body (@{
  bomId      = $v100Bom.id
  station    = "Assembly 1"
  plannedQty = 10
  startDate  = $today
  dueDate    = $dueDate
} | ConvertTo-Json)
$req = Invoke-RestMethod -Method Get -Uri "$base/production-orders/$($mo.id)/requirements" -Headers $h

# 10 packs of 100 g = 10 * 0.1 = 1 kg of parent.
$line = $req.lines | Where-Object { $_.sku -eq $pSku } | Select-Object -First 1
if (-not $line) { Fail "$pSku not in requirements (walker still treating as cycle?)" }
if ([math]::Abs($line.required - 1.0) -gt 0.001) { Fail "expected 1 kg required, got $($line.required)" }
if ($line.uom -ne "kg") { Fail "expected uom kg, got $($line.uom)" }
OK "10 packs of 100g variant correctly require 1 kg of parent (walker no longer flags as cycle)"

Write-Host "`n--- Cleanup ---" -ForegroundColor Cyan
try { Invoke-RestMethod -Method Delete -Uri "$base/products/$($parent.id)" -Headers $h | Out-Null } catch {}
OK "cleanup attempted"

Write-Host "`nALL CHECKS PASSED" -ForegroundColor Green
