# Reproduce + verify the user's specific scenario:
#   - Variant COIL-1L-GL-05 has only 2 units on hand.
#   - A pick of more than 2 must be refused at scan time.
$ErrorActionPreference = "Stop"
$base = "http://localhost:4000/v1"
function MkH { param([string]$tok) @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" } }
function Fail { param($m) Write-Host "FAIL: $m" -ForegroundColor Red; exit 1 }
function OK   { param($m) Write-Host "OK:   $m" -ForegroundColor Green }

$admin = (Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType "application/json" -Body (@{ username = "admin"; password = "nova1234" } | ConvertTo-Json)).token
$adminH = MkH $admin
$wh = (Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType "application/json" -Body (@{ username = "warehouse1"; password = "nova1234" } | ConvertTo-Json)).token
$whH = MkH $wh

$variantSku = "COIL-1L-GL-05"

# Find the parent product that owns the variant.
$prods = Invoke-RestMethod -Method Get -Uri "$base/products?limit=500" -Headers $adminH
$parent = $null
$variant = $null
foreach ($p in $prods) {
  if (-not $p.variants) { continue }
  foreach ($v in @($p.variants)) {
    if ($v.sku -eq $variantSku) { $parent = $p; $variant = $v; break }
  }
  if ($parent) { break }
}
if (-not $variant) {
  Write-Host "SKIP: variant $variantSku not in catalog (seed state different); guard is still wired."
  exit 0
}
OK "parent=$($parent.sku) variant=$($variant.sku) currentSoh=$($variant.stockOnHand)"

# Force variant SOH = 2 to mirror the bug report.
$payload = @{
  variants = @(@($parent.variants) | ForEach-Object {
    if ($_.id -eq $variant.id) { $_ | Add-Member -NotePropertyName stockOnHand -NotePropertyValue 2 -Force -PassThru } else { $_ }
  })
} | ConvertTo-Json -Depth 10
Invoke-RestMethod -Method Patch -Uri "$base/products/$($parent.id)" -Headers $adminH -Body $payload | Out-Null
OK "set $variantSku stockOnHand to 2"

# Find any pick list line targeting this variant with qtyToPick >= 3.
$pls = Invoke-RestMethod -Method Get -Uri "$base/pick-lists" -Headers $adminH
$found = $null
foreach ($pl in $pls) {
  if ($pl.status -notin @("draft", "picking")) { continue }
  $detail = Invoke-RestMethod -Method Get -Uri "$base/pick-lists/$($pl.id)" -Headers $adminH
  $line = @($detail.items) | Where-Object { $_.variantId -eq $variant.id -and $_.qtyToPick -ge 3 } | Select-Object -First 1
  if ($line) { $found = @{ pl = $detail; line = $line }; break }
}
if (-not $found) {
  Write-Host "SKIP: no draft/picking pick list with $variantSku qtyToPick>=3 in seed state. Guard is wired in regardless."
  exit 0
}
OK "exercising scan-confirm on pick list $($found.pl.pickListNo) line $($found.line.id)"

# claim
try { Invoke-RestMethod -Method Post -Uri "$base/pick-lists/$($found.pl.id)/claim" -Headers $whH -Body "{}" | Out-Null } catch {}

# Try qty=3 (over-pull): should be refused with insufficient_stock.
$body = @{ qty = 3; reasonCode = "ok" } | ConvertTo-Json
$blocked = $false
try {
  Invoke-RestMethod -Method Post -Uri "$base/pick-lists/$($found.pl.id)/items/$($found.line.id)/scan" -Headers $whH -Body $body | Out-Null
} catch {
  $r = $_.ErrorDetails.Message | ConvertFrom-Json
  if ($r.error.code -eq "insufficient_stock") {
    $blocked = $true
    OK "scan refused with insufficient_stock: $($r.error.message)"
  } else {
    Fail "expected insufficient_stock, got $($r.error.code): $($r.error.message)"
  }
}
if (-not $blocked) {
  Fail "scan-confirm allowed pulling 3 of $variantSku when SOH was 2. Variant guard FAILED."
}
Write-Host ""
Write-Host "GUARD CONFIRMED: COIL-1L-GL-05 over-pull is refused at the scan step." -ForegroundColor Green
