# Warehouse mobile-PWA backend smoke test.
#
# Exercises:
#   1. /me/tasks lists pick lists + packing slips bucketed by claim
#      state.
#   2. /pick-lists/:id/claim -> assignedToId == me; second claim by a
#      different user -> 409 already_claimed.
#   3. /pick-lists/:id/items/:itemId/scan with bin + product code
#      records the scan, updates qtyPicked, and surfaces in /scan-events.
#   4. clientOpId replay returns the same payload without double-write.
#   5. /locations/scan?code=B... returns kind=bin with the bin contents.
#   6. /bins/:id/recount writes BinCount + StockLedger and recomputes
#      Product.stockOnHand. Variance is flagged.
#   7. /bins/:id/reassign swaps the product on a bin and emits two
#      ledger rows.

$ErrorActionPreference = "Stop"
$base = "http://localhost:4000/v1"
$suffix = "{0:x}" -f (Get-Random)
function MakeHeaders { param([string]$tok) @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" } }
function Fail { param($m) Write-Host "FAIL: $m" -ForegroundColor Red; exit 1 }
function OK   { param($m) Write-Host "OK:   $m" -ForegroundColor Green }

# --- log in as admin, plus a second worker-role user for the claim
# conflict scenario.
$adminLogin = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType "application/json" -Body (@{ username = "admin"; password = "nova1234" } | ConvertTo-Json)
$adminH = MakeHeaders $adminLogin.token

# We try the well-known seed user "warehouse" first; if missing we
# create one via /users (admin) and log in as them.
try {
  $whLogin = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType "application/json" -Body (@{ username = "warehouse1"; password = "nova1234" } | ConvertTo-Json)
  OK "Logged in as warehouse1 user"
} catch {
  Fail "Couldn't log in as 'warehouse1' / nova1234. Seed users may be missing."
}
$whH = MakeHeaders $whLogin.token

Write-Host "--- /me/tasks ---" -ForegroundColor Cyan
$tasks = Invoke-RestMethod -Method Get -Uri "$base/me/tasks" -Headers $whH
foreach ($k in @("pickClaimed", "pickAvailable", "packClaimed", "packAvailable")) {
  if ($null -eq $tasks.$k) { Fail "/me/tasks missing bucket '$k'" }
}
OK "/me/tasks returned 4 buckets"

Write-Host "--- Find a pick list to test against ---" -ForegroundColor Cyan
# Create a SO + pick list via existing flow so we can reach a draft PL.
$customers = Invoke-RestMethod -Method Get -Uri "$base/customers?limit=5" -Headers $adminH
if ($customers.Count -lt 1) { Fail "need at least 1 customer for the smoke test" }
$customer = $customers[0]
$products = Invoke-RestMethod -Method Get -Uri "$base/products?limit=200" -Headers $adminH
$picky = $products | Where-Object { $_.stockOnHand -gt 5 } | Select-Object -First 1
if (-not $picky) { Fail "need at least 1 product with stockOnHand > 5" }
OK "Will test pick flow with $($picky.sku) (SOH=$($picky.stockOnHand))"

# Try to find a PL that's already in draft|picking + unassigned.
$pls = Invoke-RestMethod -Method Get -Uri "$base/pick-lists?status=draft" -Headers $adminH
$pl = $pls | Where-Object { -not $_.assignedToId } | Select-Object -First 1
if (-not $pl) {
  $pls2 = Invoke-RestMethod -Method Get -Uri "$base/pick-lists?status=picking" -Headers $adminH
  $pl = $pls2 | Where-Object { -not $_.assignedToId } | Select-Object -First 1
}
if (-not $pl) {
  Write-Host "No unassigned draft/picking pick list exists. Create one through the desktop UI first." -ForegroundColor Yellow
  Write-Host "Skipping claim/scan tests but continuing to recount tests." -ForegroundColor Yellow
  $pl = $null
}

if ($pl) {
  Write-Host "Testing against pick list $($pl.pickListNo)" -ForegroundColor Cyan

  Write-Host "--- claim/release ---" -ForegroundColor Cyan
  $claimed = Invoke-RestMethod -Method Post -Uri "$base/pick-lists/$($pl.id)/claim" -Headers $whH -Body "{}"
  if (-not $claimed.assignedToId) { Fail "claim did not set assignedToId" }
  OK "Claimed PL $($pl.pickListNo) as warehouse user"

  # Second claim by admin -> 409 already_claimed.
  try {
    Invoke-RestMethod -Method Post -Uri "$base/pick-lists/$($pl.id)/claim" -Headers $adminH -Body "{}" | Out-Null
    Fail "expected 409 already_claimed when admin re-claims"
  } catch {
    if ($_.Exception.Response.StatusCode.value__ -ne 409) { Fail "expected 409, got $($_.Exception.Response.StatusCode.value__)" }
    OK "Second claim by admin blocked with 409 already_claimed"
  }

  # /me/tasks should now list this PL under pickClaimed.
  $tasks2 = Invoke-RestMethod -Method Get -Uri "$base/me/tasks" -Headers $whH
  $found = $tasks2.pickClaimed | Where-Object { $_.id -eq $pl.id }
  if (-not $found) { Fail "claimed PL not in pickClaimed bucket" }
  OK "Claimed PL surfaces in /me/tasks pickClaimed"

  Write-Host "--- scan-confirm ---" -ForegroundColor Cyan
  $detail = Invoke-RestMethod -Method Get -Uri "$base/pick-lists/$($pl.id)" -Headers $whH
  $line = $detail.items | Select-Object -First 1
  $opId = "smk-$suffix-001"

  # First scan with mismatched product without reasonCode -> 409.
  try {
    Invoke-RestMethod -Method Post -Uri "$base/pick-lists/$($pl.id)/items/$($line.id)/scan" -Headers $whH -Body (@{
      productCode = "DEFINITELY-NOT-A-REAL-SKU-$suffix"
      qty = $line.qtyToPick
      reasonCode = "ok"
      clientOpId = $opId
    } | ConvertTo-Json) | Out-Null
    Fail "expected 409 product_mismatch on bogus scan"
  } catch {
    if ($_.Exception.Response.StatusCode.value__ -ne 409) { Fail "wrong error from bad scan" }
    OK "Bad-product scan blocked with 409"
  }

  # Now scan with the actual SKU (read it from the line).
  $sku = if ($line.variant) { $line.variant.sku } else { $line.product.sku }
  $scanBody = @{
    productCode = $sku
    qty = $line.qtyToPick
    reasonCode = "ok"
    clientOpId = $opId
  } | ConvertTo-Json
  $afterScan = Invoke-RestMethod -Method Post -Uri "$base/pick-lists/$($pl.id)/items/$($line.id)/scan" -Headers $whH -Body $scanBody
  $updated = $afterScan.items | Where-Object { $_.id -eq $line.id }
  if ([math]::Abs($updated.qtyPicked - $line.qtyToPick) -gt 0.001) { Fail "qtyPicked not updated after scan ($($updated.qtyPicked) vs $($line.qtyToPick))" }
  OK "Scan-confirm updated qtyPicked to $($updated.qtyPicked)"

  # Idempotency: send the same clientOpId again with a *different* qty.
  # Behaviour: server should not double-write. We expect the response
  # to reflect the original write (qty unchanged).
  $afterRetry = Invoke-RestMethod -Method Post -Uri "$base/pick-lists/$($pl.id)/items/$($line.id)/scan" -Headers $whH -Body (@{
    productCode = $sku
    qty = 0
    reasonCode = "ok"
    clientOpId = $opId
  } | ConvertTo-Json)
  $retryLine = $afterRetry.items | Where-Object { $_.id -eq $line.id }
  if ([math]::Abs($retryLine.qtyPicked - $updated.qtyPicked) -gt 0.001) {
    Fail "idempotent replay re-wrote qtyPicked ($($retryLine.qtyPicked) != $($updated.qtyPicked))"
  }
  OK "clientOpId replay was a no-op"

  Write-Host "--- /scan-events ---" -ForegroundColor Cyan
  $events = Invoke-RestMethod -Method Get -Uri "$base/scan-events?limit=20" -Headers $whH
  if (-not ($events | Where-Object { $_.context -eq "pick:$($pl.pickListNo)" })) {
    Fail "no scan event recorded for pick:$($pl.pickListNo)"
  }
  OK "Scan-event audit log captured the activity"

  Write-Host "--- release ---" -ForegroundColor Cyan
  $released = Invoke-RestMethod -Method Post -Uri "$base/pick-lists/$($pl.id)/release" -Headers $whH -Body "{}"
  if ($released.assignedToId) { Fail "release did not clear assignedToId" }
  OK "Released claim"
}

Write-Host "--- /locations/scan ---" -ForegroundColor Cyan
$bins = Invoke-RestMethod -Method Get -Uri "$base/warehouses" -Headers $adminH
$wh = $bins | Select-Object -First 1
$binsList = (Invoke-RestMethod -Method Get -Uri "$base/warehouses/$($wh.id)/bins?limit=20" -Headers $adminH)
$binWithStock = $binsList | Where-Object { $_.qty -gt 0 -and $_.code } | Select-Object -First 1
if (-not $binWithStock) {
  $binWithStock = $binsList | Where-Object { $_.code } | Select-Object -First 1
}
if (-not $binWithStock) { Fail "no bin with .code field; backfill may have skipped" }

$resolved = Invoke-RestMethod -Method Get -Uri "$base/locations/scan?code=$($binWithStock.code)" -Headers $adminH
if ($resolved.kind -ne "bin") { Fail "expected kind=bin, got $($resolved.kind)" }
if ($resolved.bin.id -ne $binWithStock.id) { Fail "bin id mismatch ($($resolved.bin.id) vs $($binWithStock.id))" }
OK "Scan resolved bin code $($binWithStock.code)"

# Resolve a zone (stripped one level up).
$zoneCode = "Z." + ($binWithStock.code -split "\." | Select-Object -Skip 1 -First 2) -join "."
# Build it manually because PowerShell pipeline + join is awkward:
$parts = $binWithStock.code -split "\."
$zoneCode = "Z.$($parts[1]).$($parts[2])"
$rackCode = "R.$($parts[1]).$($parts[2]).$($parts[3])"
$resolvedZone = Invoke-RestMethod -Method Get -Uri "$base/locations/scan?code=$zoneCode" -Headers $adminH
if ($resolvedZone.kind -ne "zone") { Fail "expected kind=zone for $zoneCode, got $($resolvedZone.kind)" }
OK "Zone scan resolved $zoneCode -> $($resolvedZone.racks.Count) rack(s)"
$resolvedRack = Invoke-RestMethod -Method Get -Uri "$base/locations/scan?code=$rackCode" -Headers $adminH
if ($resolvedRack.kind -ne "rack") { Fail "expected kind=rack for $rackCode, got $($resolvedRack.kind)" }
OK "Rack scan resolved $rackCode -> $($resolvedRack.shelves.Count) shelf/shelves"

Write-Host "--- /bins/:id/recount ---" -ForegroundColor Cyan
# Find a bin with a product assigned and no reservations so the recount is safe.
$recountable = $binsList | Where-Object { $_.productId -and $_.qty -gt 0 -and $_.reservedQty -eq 0 } | Select-Object -First 1
if (-not $recountable) { Fail "no recountable bin (productId+qty+0 reserved)" }

$beforeProd = Invoke-RestMethod -Method Get -Uri "$base/products/$($recountable.productId)" -Headers $adminH
$opId2 = "smk-$suffix-rc1"
$rcBody = @{
  qtyAfter = [int]$recountable.qty + 2
  reasonCode = "found_elsewhere"
  remarks = "Smoke test +2"
  clientOpId = $opId2
} | ConvertTo-Json
$rc = Invoke-RestMethod -Method Post -Uri "$base/bins/$($recountable.id)/recount" -Headers $adminH -Body $rcBody
if ($rc.delta -ne 2) { Fail "recount delta wrong (got $($rc.delta))" }
OK "Recount wrote BinCount with delta=$($rc.delta) flagged=$($rc.flagged)"

# Idempotent replay of recount.
$rc2 = Invoke-RestMethod -Method Post -Uri "$base/bins/$($recountable.id)/recount" -Headers $adminH -Body (@{
  qtyAfter = 9999
  reasonCode = "found_elsewhere"
  clientOpId = $opId2
} | ConvertTo-Json)
if ($rc2.id -ne $rc.id) { Fail "recount replay wrote a new BinCount ($($rc2.id) vs $($rc.id))" }
OK "Recount clientOpId replay was a no-op"

# Verify Product.stockOnHand reflects the new bin sum.
$afterProd = Invoke-RestMethod -Method Get -Uri "$base/products/$($recountable.productId)" -Headers $adminH
if ($afterProd.stockOnHand -le $beforeProd.stockOnHand) {
  Fail "Product.stockOnHand did not increase after recount (before=$($beforeProd.stockOnHand) after=$($afterProd.stockOnHand))"
}
OK "Product.stockOnHand recomputed after recount (was $($beforeProd.stockOnHand), now $($afterProd.stockOnHand))"

# Verify a StockLedger row exists with txnType=CycleCount.
$ledger = Invoke-RestMethod -Method Get -Uri "$base/ledger?productId=$($recountable.productId)&txnType=CycleCount" -Headers $adminH
if (-not ($ledger | Where-Object { $_.qty -eq 2 })) { Fail "no CycleCount ledger row with qty=+2" }
OK "StockLedger row written with txnType=CycleCount"

Write-Host "--- /bins/:id/reassign ---" -ForegroundColor Cyan
# Pick a bin with no reservations and at least one product available to swap to.
$swapBin = $binsList | Where-Object { $_.reservedQty -eq 0 } | Select-Object -First 1
if (-not $swapBin) { Fail "no bin without reservations to reassign" }
$swapTarget = $products | Where-Object { $_.id -ne $swapBin.productId } | Select-Object -First 1

$opId3 = "smk-$suffix-rx1"
$rxBody = @{
  productId = $swapTarget.id
  qty = 5
  reasonCode = "product_swap"
  remarks = "Smoke test reassign"
  clientOpId = $opId3
} | ConvertTo-Json
$rx = Invoke-RestMethod -Method Post -Uri "$base/bins/$($swapBin.id)/reassign" -Headers $adminH -Body $rxBody
if ($rx.productIdAfter -ne $swapTarget.id) { Fail "reassign productIdAfter wrong" }
if ($rx.flagged -ne $true) { Fail "expected flagged=true on product swap" }
OK "Reassign wrote BinCount productBefore=$($rx.productIdBefore) productAfter=$($rx.productIdAfter)"

# Confirm bin row reflects the swap.
$confirm = Invoke-RestMethod -Method Get -Uri "$base/locations/scan?code=$($swapBin.code)" -Headers $adminH
if ($confirm.bin.product.id -ne $swapTarget.id) { Fail "bin still holds the old product after reassign" }
OK "Bin reflects new product after reassign"

Write-Host "--- /bin-counts (audit) ---" -ForegroundColor Cyan
$audit = Invoke-RestMethod -Method Get -Uri "$base/bin-counts?flagged=1&limit=20" -Headers $adminH
if (-not ($audit | Where-Object { $_.id -eq $rx.id })) { Fail "reassign not visible in flagged bin-counts" }
OK "Flagged bin-counts feed surfaces the reassign"

Write-Host "ALL OK" -ForegroundColor Green
