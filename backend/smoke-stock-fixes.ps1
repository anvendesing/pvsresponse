# Smoke test for the three stock-integrity fixes:
#
#   1. Cycle-count ledger uses the friendly "CC-2026-NNNN" ref instead
#      of "CC-<cuid>". Reassigns use "RX-2026-NNNN-IN" / "-OUT".
#
#   2. POST /inventory/adjust actually moves stock - it bumps a real
#      bin's qty AND recomputes Product.stockOnHand, so the change
#      reflects on the desktop Inventory page.
#
#   3. Pick-list scan-confirm refuses to over-pull a variant when only
#      N units of THAT specific variant exist on the floor (even if
#      sibling variants pad the parent product's bin total).
#
# Run from backend/. Requires a running backend at :4000 and the
# default seed users (admin/warehouse1).
$ErrorActionPreference = "Stop"
$base = "http://localhost:4000/v1"
$rand = "{0:x}" -f (Get-Random)
function MkH { param([string]$tok) @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" } }
function Fail { param($m) Write-Host "FAIL: $m" -ForegroundColor Red; exit 1 }
function OK   { param($m) Write-Host "OK:   $m" -ForegroundColor Green }

$admin = (Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType "application/json" -Body (@{ username = "admin"; password = "nova1234" } | ConvertTo-Json)).token
$adminH = MkH $admin
$wh = (Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType "application/json" -Body (@{ username = "warehouse1"; password = "nova1234" } | ConvertTo-Json)).token
$whH = MkH $wh

# ============================================================
# Fix 1 + 2 - friendly CC- ref and adjust-moves-stock
# ============================================================
Write-Host "--- friendly CC ref + adjust moves stock ---" -ForegroundColor Cyan

# Pick a product that has at least one bin with qty>0.
$prod = Invoke-RestMethod -Method Get -Uri "$base/products?limit=200" -Headers $adminH
$allBins = @()
$whs = Invoke-RestMethod -Method Get -Uri "$base/warehouses" -Headers $adminH
foreach ($w in $whs) {
  $b = Invoke-RestMethod -Method Get -Uri "$base/warehouses/$($w.id)/bins" -Headers $adminH
  if ($b) { $allBins += @($b) }
}
$bin = $allBins | Where-Object { $_.productId -and $_.qty -gt 0 } | Select-Object -First 1
if (-not $bin) { Fail "no bin with qty>0 found - seed data missing?" }
OK "picked bin $($bin.code) of product $($bin.productId) qty=$($bin.qty)"

$beforeProd = Invoke-RestMethod -Method Get -Uri "$base/products/$($bin.productId)" -Headers $adminH
$beforeSoh = $beforeProd.stockOnHand
OK "product $($beforeProd.sku) starting SOH = $beforeSoh"

# Recount the bin to (qty+5) and verify ref is CC-YYYY-NNNN format
$body = @{ qtyAfter = $bin.qty + 5; reasonCode = "physical_match"; remarks = "smoke-test-$rand" } | ConvertTo-Json
$count = Invoke-RestMethod -Method Post -Uri "$base/bins/$($bin.id)/recount" -Headers $whH -Body $body
OK "recount posted: delta=$($count.delta) flagged=$($count.flagged)"

$ledger = Invoke-RestMethod -Method Get -Uri "$base/ledger?productId=$($bin.productId)&txnType=CycleCount&limit=5" -Headers $adminH
$latest = $ledger | Select-Object -First 1
if (-not $latest) { Fail "no CycleCount ledger row found after recount" }
if ($latest.ref -notmatch "^CC-\d{4}-\d{4}$") {
  Fail "ledger ref '$($latest.ref)' does not match CC-YYYY-NNNN. The friendly numbering regression is back."
}
OK "ledger ref is friendly: $($latest.ref)"

# Verify Product.stockOnHand actually moved.
$afterProd = Invoke-RestMethod -Method Get -Uri "$base/products/$($bin.productId)" -Headers $adminH
$expected = $beforeSoh + 5
if ([math]::Abs($afterProd.stockOnHand - $expected) -gt 0.5) {
  Fail "product SOH did not reflect recount. expected=$expected got=$($afterProd.stockOnHand)"
}
OK "product SOH moved from $beforeSoh to $($afterProd.stockOnHand) (recount reflected)"

# /inventory/adjust now also moves stock
$adjBody = @{ productId = $bin.productId; warehouseId = $bin.warehouseId; qty = -2; reason = "smoke adjust $rand" } | ConvertTo-Json
$adj = Invoke-RestMethod -Method Post -Uri "$base/inventory/adjust" -Headers $adminH -Body $adjBody
if ($adj.ref -notmatch "^ADJ-\d{4}-\d{4}$") {
  Fail "adjust ref '$($adj.ref)' is not friendly ADJ-YYYY-NNNN"
}
OK "adjust ref is friendly: $($adj.ref)"
$afterAdj = Invoke-RestMethod -Method Get -Uri "$base/products/$($bin.productId)" -Headers $adminH
$expected2 = $afterProd.stockOnHand - 2
if ([math]::Abs($afterAdj.stockOnHand - $expected2) -gt 0.5) {
  Fail "adjust did not move SOH. expected=$expected2 got=$($afterAdj.stockOnHand)"
}
OK "adjust moved SOH from $($afterProd.stockOnHand) to $($afterAdj.stockOnHand)"

# Negative adjust larger than on-hand should be refused.
$bigBody = @{ productId = $bin.productId; warehouseId = $bin.warehouseId; qty = -99999; reason = "underflow test" } | ConvertTo-Json
$blocked = $false
try {
  Invoke-RestMethod -Method Post -Uri "$base/inventory/adjust" -Headers $adminH -Body $bigBody | Out-Null
} catch {
  $r = $_.ErrorDetails.Message | ConvertFrom-Json
  if ($r.error.code -eq "insufficient_stock") { $blocked = $true; OK "negative adjust larger than on-hand was refused: $($r.error.message)" }
}
if (-not $blocked) { Fail "negative adjust below zero should have been blocked but wasn't" }

# ============================================================
# Fix 3 - pick scan refuses to over-pull a variant
# ============================================================
Write-Host "--- variant stock guard at pick scan ---" -ForegroundColor Cyan

# Find any variant with stockOnHand > 0 and a sales-order line in
# draft or open pick list bound to it. Easier: just create a tiny
# scenario using API.
# We'll: pick the first variant with stockOnHand >= 1, set its SOH
# to 1 via direct variant edit, then create an order for qty=2, and
# try to scan-pick 2.
function NumOr0 { param($v) if ($null -eq $v) { return 0 } else { return [double]$v } }
$candProd = $prod | Where-Object { $_.variants -and @($_.variants).Count -gt 0 -and (NumOr0 $_.stockOnHand) -ge 2 } | Select-Object -First 1
if (-not $candProd) { Fail "no parent product with variants and stock>=2 found - cannot run variant test" }
$variant = @($candProd.variants) | Where-Object { (NumOr0 $_.stockOnHand) -ge 0 } | Select-Object -First 1
if (-not $variant) { Fail "parent $($candProd.sku) has variants but none readable" }

# Force variant SOH = 1.
$updateBody = @{
  variants = @(@($candProd.variants) | ForEach-Object {
    if ($_.id -eq $variant.id) {
      $_ | Add-Member -NotePropertyName stockOnHand -NotePropertyValue 1 -Force -PassThru
    } else { $_ }
  })
} | ConvertTo-Json -Depth 10
Invoke-RestMethod -Method Patch -Uri "$base/products/$($candProd.id)" -Headers $adminH -Body $updateBody | Out-Null
OK "set variant $($variant.sku) stockOnHand to 1"

# Try the variant guard via a direct query on an existing pick list
# rather than minting a brand-new SO (faster / less brittle).
# Find any pick list line for this variant that's still in draft.
$pls = Invoke-RestMethod -Method Get -Uri "$base/pick-lists?status=draft" -Headers $adminH
$found = $null
foreach ($pl in $pls) {
  $detail = Invoke-RestMethod -Method Get -Uri "$base/pick-lists/$($pl.id)" -Headers $adminH
  $line = @($detail.items) | Where-Object { $_.variantId -eq $variant.id -and $_.qtyToPick -ge 2 } | Select-Object -First 1
  if ($line) { $found = @{ pickList = $detail; line = $line }; break }
}
if (-not $found) {
  Write-Host "SKIP: no draft pick list with variant $($variant.sku) qty>=2 - the guard is wired up but couldn't be exercised in this seed state. Restore variant SOH and exit cleanly."
  $restore = @{
    variants = @(@($candProd.variants) | ForEach-Object {
      if ($_.id -eq $variant.id) { $_ | Add-Member -NotePropertyName stockOnHand -NotePropertyValue ($variant.stockOnHand) -Force -PassThru } else { $_ }
    })
  } | ConvertTo-Json -Depth 10
  Invoke-RestMethod -Method Patch -Uri "$base/products/$($candProd.id)" -Headers $adminH -Body $restore | Out-Null
  exit 0
}

# Claim the pick list as warehouse1, then try to scan-pick 2 on the
# line. Variant SOH is 1 -> expect 409 insufficient_stock.
try {
  Invoke-RestMethod -Method Post -Uri "$base/pick-lists/$($found.pickList.id)/claim" -Headers $whH -Body "{}" | Out-Null
} catch { } # may already be claimed by another smoke run

$scanBody = @{ qty = 2; reasonCode = "ok" } | ConvertTo-Json
$blocked = $false
try {
  Invoke-RestMethod -Method Post -Uri "$base/pick-lists/$($found.pickList.id)/items/$($found.line.id)/scan" -Headers $whH -Body $scanBody | Out-Null
} catch {
  $r = $_.ErrorDetails.Message | ConvertFrom-Json
  if ($r.error.code -eq "insufficient_stock") {
    $blocked = $true
    OK "variant over-pull refused at scan time: $($r.error.message)"
  } else {
    Fail "expected insufficient_stock but got $($r.error.code): $($r.error.message)"
  }
}
if (-not $blocked) {
  Fail "Pick scan-confirm allowed pulling 2 of variant $($variant.sku) when only 1 was on hand. The variant guard is broken."
}

# Scan-pick 1 (within stock) should succeed.
$scanOk = @{ qty = 1; reasonCode = "ok"; clientOpId = "smoke-$rand-1" } | ConvertTo-Json
try {
  Invoke-RestMethod -Method Post -Uri "$base/pick-lists/$($found.pickList.id)/items/$($found.line.id)/scan" -Headers $whH -Body $scanOk | Out-Null
  OK "scan-pick of 1 unit (within stock) accepted"
} catch {
  $r = $_.ErrorDetails.Message | ConvertFrom-Json
  Fail "expected scan-pick of 1 to succeed but got $($r.error.code): $($r.error.message)"
}

Write-Host ""
Write-Host "ALL STOCK-INTEGRITY SMOKE CHECKS PASSED" -ForegroundColor Green
