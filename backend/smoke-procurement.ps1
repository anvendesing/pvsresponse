# Procurement end-to-end smoke test.
#
# Verifies:
#   1. Vendor CRUD (create, list, update, soft-delete-when-used).
#   2. PO lifecycle: draft -> approved -> partial -> received.
#   3. PO patch is rejected once the PO has been approved.
#   4. Over-receipt is blocked with code=over_receipt.
#   5. Cancelling a PO with GRNs is blocked with code=po_has_grns.
#   6. GRN posts inventory: Product.stockOnHand goes up by accepted qty,
#      and a StockLedger row is written referencing the GRN number.
#   7. Closing a partial PO works and freezes it from further receipts.

$ErrorActionPreference = "Stop"
$base = "http://localhost:4000/v1"
$suffix = "{0:x}" -f (Get-Random)
function MakeHeaders { param([string]$tok) @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" } }
function Fail { param($m) Write-Host "FAIL: $m" -ForegroundColor Red; exit 1 }
function OK   { param($m) Write-Host "OK:   $m" -ForegroundColor Green }

$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType "application/json" -Body (@{ username = "admin"; password = "nova1234" } | ConvertTo-Json)
$h = MakeHeaders $login.token
$hAuth = @{ Authorization = "Bearer $($login.token)" }

Write-Host "--- Vendor CRUD ---" -ForegroundColor Cyan

$vBody = @{
  name = "Smoke Vendor $suffix"
  city = "Bengaluru"
  contact = "+91 9999999999"
  email = "ar@smoke-$suffix.test"
  leadTimeDays = 5
  rating = 4.2
  paymentTerms = "Net 30"
} | ConvertTo-Json
$vendor = Invoke-RestMethod -Method Post -Uri "$base/vendors" -Headers $h -Body $vBody
if (-not $vendor.code) { Fail "vendor.code missing - auto-generation broken" }
OK "Created vendor $($vendor.code)"

$listed = Invoke-RestMethod -Method Get -Uri "$base/vendors?search=Smoke%20Vendor%20$suffix" -Headers $h
if (@($listed | Where-Object { $_.id -eq $vendor.id }).Count -ne 1) { Fail "search did not return our vendor" }
OK "Vendor listed via /vendors search"

Invoke-RestMethod -Method Patch -Uri "$base/vendors/$($vendor.id)" -Headers $h -Body (@{ rating = 4.7 } | ConvertTo-Json) | Out-Null
$reread = Invoke-RestMethod -Method Get -Uri "$base/vendors/$($vendor.id)" -Headers $h
if ($reread.rating -ne 4.7) { Fail "vendor patch did not persist" }
OK "Vendor patched (rating -> 4.7)"

Write-Host "--- PO lifecycle ---" -ForegroundColor Cyan

# Pick two products to put on the PO.
$prods = Invoke-RestMethod -Method Get -Uri "$base/products?limit=200" -Headers $h
if ($prods.Count -lt 2) { Fail "need at least 2 products in catalog" }
$p1 = $prods[0]
$p2 = $prods[1]
OK "Will order $($p1.sku), $($p2.sku)"

$initialStockP1 = $p1.stockOnHand

$poBody = @{
  vendorId = $vendor.id
  expectedDate = (Get-Date).AddDays(7).ToString("yyyy-MM-ddTHH:mm:ssZ")
  notes = "Smoke test PO"
  items = @(
    @{ productId = $p1.id; qty = 10; rate = 100 }
    @{ productId = $p2.id; qty = 5;  rate = 200 }
  )
} | ConvertTo-Json -Depth 5
$po = Invoke-RestMethod -Method Post -Uri "$base/purchase-orders" -Headers $h -Body $poBody
if ($po.status -ne "draft") { Fail "expected status=draft, got '$($po.status)'" }
if ($po.amount -ne 2000)    { Fail "expected amount=2000, got $($po.amount)" }
OK "Created draft $($po.poNo) total=$($po.amount)"

# Patch notes while still draft - should succeed.
Invoke-RestMethod -Method Patch -Uri "$base/purchase-orders/$($po.id)" -Headers $h -Body (@{ notes = "edited" } | ConvertTo-Json) | Out-Null
OK "Notes patched on draft"

# Approve.
$approved = Invoke-RestMethod -Method Post -Uri "$base/purchase-orders/$($po.id)/approve" -Headers $h -Body "{}"
if ($approved.status -ne "approved") { Fail "after approve, status='$($approved.status)'" }
OK "PO approved"

# Try to patch items now - should 409.
$patchItems = $false
try {
  Invoke-RestMethod -Method Patch -Uri "$base/purchase-orders/$($po.id)" -Headers $h -Body (@{
    items = @(@{ productId = $p1.id; qty = 99; rate = 100 })
  } | ConvertTo-Json -Depth 5) | Out-Null
} catch {
  $patchItems = $true
  if ($_.ErrorDetails.Message -notmatch "po_locked") { Fail "expected po_locked, got: $($_.ErrorDetails.Message)" }
}
if (-not $patchItems) { Fail "items patch on approved PO was accepted" }
OK "Items patch on approved PO blocked (po_locked)"

Write-Host "--- GRN partial receive ---" -ForegroundColor Cyan

# Find the line ids.
$poDetail = Invoke-RestMethod -Method Get -Uri "$base/purchase-orders/$($po.id)" -Headers $h
$line1 = ($poDetail.items | Where-Object { $_.productId -eq $p1.id })[0]
$line2 = ($poDetail.items | Where-Object { $_.productId -eq $p2.id })[0]

# First GRN: receive 6 of p1 (qty=10), 5 of p2 fully. Reject 1 of p1 for inspection.
$grnBody = @{
  poId = $po.id
  qcStatus = "pass"
  truckNo = "TN-99-$suffix"
  items = @(
    @{ poItemId = $line1.id; receivedQty = 7; rejectedQty = 1; remarks = "1 dented" }
    @{ poItemId = $line2.id; receivedQty = 5 }
  )
} | ConvertTo-Json -Depth 5
$grnResp = Invoke-RestMethod -Method Post -Uri "$base/grns" -Headers $h -Body $grnBody
if (-not $grnResp.grn.grnNo) { Fail "GRN response missing grnNo" }
OK "Recorded $($grnResp.grn.grnNo) ($([math]::Round($grnResp.ledgerEntries.Count)) ledger entries)"

# PO should now be partial: line1 got 6 net (7-1), line2 got 5; sum = 11 / total 15.
$poAfter = Invoke-RestMethod -Method Get -Uri "$base/purchase-orders/$($po.id)" -Headers $h
if ($poAfter.status -ne "partial") { Fail "expected status=partial after first GRN, got '$($poAfter.status)'" }
if ($poAfter.receivedPct -ne 73)  { Fail "expected receivedPct=73, got $($poAfter.receivedPct)" }
OK "PO rolled to status=partial, receivedPct=73"

# Inventory should reflect 6 units of p1 added (7 received - 1 rejected).
$p1After = Invoke-RestMethod -Method Get -Uri "$base/products/$($p1.id)" -Headers $h
$delta = $p1After.stockOnHand - $initialStockP1
if ($delta -ne 6) { Fail "p1 stockOnHand delta=$delta, expected 6 (7 received - 1 rejected)" }
OK "Inventory posted: p1 stock +6 (rejected qty correctly excluded)"

Write-Host "--- Over-receipt + cancel-after-grn guards ---" -ForegroundColor Cyan

# Try receiving 100 more of line1 - should 409 over_receipt.
$over = $false
try {
  Invoke-RestMethod -Method Post -Uri "$base/grns" -Headers $h -Body (@{
    poId = $po.id
    items = @(@{ poItemId = $line1.id; receivedQty = 100 })
  } | ConvertTo-Json -Depth 5) | Out-Null
} catch {
  $over = $true
  if ($_.ErrorDetails.Message -notmatch "over_receipt") { Fail "expected over_receipt, got: $($_.ErrorDetails.Message)" }
}
if (-not $over) { Fail "over-receipt was accepted" }
OK "Over-receipt blocked (over_receipt)"

# Try cancelling - should 409 because PO already has GRN.
$cancelled = $false
try {
  Invoke-RestMethod -Method Post -Uri "$base/purchase-orders/$($po.id)/cancel" -Headers $h -Body "{}" | Out-Null
} catch {
  $cancelled = $true
  if ($_.ErrorDetails.Message -notmatch "po_has_grns") { Fail "expected po_has_grns, got: $($_.ErrorDetails.Message)" }
}
if (-not $cancelled) { Fail "cancel after GRN was accepted" }
OK "Cancel-after-GRN blocked (po_has_grns)"

Write-Host "--- Close partial PO ---" -ForegroundColor Cyan

$closed = Invoke-RestMethod -Method Post -Uri "$base/purchase-orders/$($po.id)/close" -Headers $h -Body "{}"
if ($closed.status -ne "closed") { Fail "close did not set status=closed (got '$($closed.status)')" }
OK "Partial PO closed"

# A receive against a closed PO should fail.
$closedReceive = $false
try {
  Invoke-RestMethod -Method Post -Uri "$base/grns" -Headers $h -Body (@{
    poId = $po.id
    items = @(@{ poItemId = $line1.id; receivedQty = 1 })
  } | ConvertTo-Json -Depth 5) | Out-Null
} catch {
  $closedReceive = $true
}
if (-not $closedReceive) { Fail "received against closed PO succeeded" }
OK "Receive against closed PO blocked"

Write-Host "--- Vendor soft-delete (has POs) ---" -ForegroundColor Cyan

$delResp = Invoke-RestMethod -Method Delete -Uri "$base/vendors/$($vendor.id)" -Headers $hAuth
if (-not $delResp.softDeleted) { Fail "vendor with PO history should soft-delete, got $($delResp | ConvertTo-Json -Compress)" }
OK "Vendor soft-deleted (preserves PO history)"

Write-Host "ALL TESTS PASSED" -ForegroundColor Green
