# Storefront-mock end-to-end smoke.
#
# What it asserts:
#   1. POST /storefront-mock/order creates a Customer + CustomerAccount
#      (fresh email each run so we always exercise the "new" branch).
#   2. SO is confirmed and has source="ecommerce".
#   3. Invoice is paid and ties back to the SO.
#   4. ProductVariant.stockOnHand decremented by exactly the ordered qty.
#   5. A draft pick list was auto-created and shows up in /pick-lists.
#   6. /storefront-mock/order refuses an over-pull with 409 insufficient_stock.
#   7. After completing the pick + marking the slip packed, the slip
#      carries the mock AWB and "MockCourier" carrier.
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

# --- Pick a variant from the public catalog. -------------------------
Write-Host "--- catalog ---" -ForegroundColor Cyan
$catalog = Invoke-RestMethod -Method Get -Uri "$base/storefront-mock/catalog"
$pickedProduct = $null
$pickedVariant = $null
foreach ($p in $catalog) {
  foreach ($v in @($p.variants)) {
    if ($v.stockOnHand -ge 3) { $pickedProduct = $p; $pickedVariant = $v; break }
  }
  if ($pickedVariant) { break }
}
if (-not $pickedVariant) { Fail "no variant with stockOnHand>=3 found in catalog" }
$startingSoh = [int]$pickedVariant.stockOnHand
OK "picked variant $($pickedVariant.sku) (parent $($pickedProduct.sku)) stockOnHand=$startingSoh"

# --- Place a prepaid order. ------------------------------------------
Write-Host "--- POST /storefront-mock/order ---" -ForegroundColor Cyan
$orderBody = @{
  name  = "Smoke Customer $rand"
  email = "smoke-$rand@example.com"
  phone = "+91 99999 00000"
  city  = "Hyderabad"
  notes = "smoke run $rand"
  items = @(@{
    productId = $pickedProduct.id
    variantId = $pickedVariant.id
    qty       = 2
  })
} | ConvertTo-Json -Depth 5
$res = Invoke-RestMethod -Method Post -Uri "$base/storefront-mock/order" -ContentType "application/json" -Body $orderBody
if (-not $res.salesOrder.soNo) { Fail "no SO returned: $($res | ConvertTo-Json -Depth 5)" }
if ($res.salesOrder.status -ne "confirmed") { Fail "SO status was '$($res.salesOrder.status)', expected 'confirmed'" }
if ($res.invoice.status -ne "paid") { Fail "invoice status was '$($res.invoice.status)', expected 'paid'" }
if (-not $res.pickList.pickListNo) { Fail "no pick list created: $($res.pickList | ConvertTo-Json)" }
OK "order placed: SO=$($res.salesOrder.soNo) Invoice=$($res.invoice.invoiceNo) PickList=$($res.pickList.pickListNo)"
OK "customer=$($res.customer.name) ($($res.customer.code))  account=$($res.customerAccount.email)"

# --- Stock decrement reflected in catalog. ---------------------------
$catalog2 = Invoke-RestMethod -Method Get -Uri "$base/storefront-mock/catalog"
$after = $null
foreach ($p in $catalog2) {
  foreach ($v in @($p.variants)) {
    if ($v.id -eq $pickedVariant.id) { $after = $v; break }
  }
  if ($after) { break }
}
$afterSoh = if ($after) { [int]$after.stockOnHand } else { 0 }
$expected = $startingSoh - 2
if ($afterSoh -ne $expected) {
  Fail "variant stockOnHand did not drop by 2. before=$startingSoh after=$afterSoh expected=$expected"
}
OK "variant stockOnHand decremented from $startingSoh to $afterSoh"

# --- SO source is ecommerce. -----------------------------------------
$so = Invoke-RestMethod -Method Get -Uri "$base/sales-orders/$($res.salesOrder.id)" -Headers $adminH
if ($so.source -ne "ecommerce") { Fail "SO.source='$($so.source)', expected 'ecommerce'" }
OK "SO.source = ecommerce"

# --- Over-pull refused. ----------------------------------------------
Write-Host "--- over-pull guard ---" -ForegroundColor Cyan
$bigBody = @{
  name  = "Smoke Overpull $rand"
  email = "overpull-$rand@example.com"
  phone = "+91 99999 00001"
  items = @(@{
    productId = $pickedProduct.id
    variantId = $pickedVariant.id
    qty       = 999999
  })
} | ConvertTo-Json -Depth 5
$blocked = $false
try {
  Invoke-RestMethod -Method Post -Uri "$base/storefront-mock/order" -ContentType "application/json" -Body $bigBody | Out-Null
} catch {
  $r = $_.ErrorDetails.Message | ConvertFrom-Json
  if ($r.error.code -eq "insufficient_stock") {
    $blocked = $true
    OK "over-pull refused: $($r.error.message)"
  } else {
    Fail "expected insufficient_stock, got $($r.error.code): $($r.error.message)"
  }
}
if (-not $blocked) { Fail "over-pull was not refused" }

# --- Pick + pack to confirm AWB stamping. ----------------------------
Write-Host "--- pick + pack ---" -ForegroundColor Cyan
$plId = $res.pickList.id
Invoke-RestMethod -Method Post -Uri "$base/pick-lists/$plId/claim" -Headers $whH -Body "{}" | Out-Null
$pl = Invoke-RestMethod -Method Get -Uri "$base/pick-lists/$plId" -Headers $whH
$lineId = $pl.items[0].id
$scanBody = @{ qty = $pl.items[0].qtyToPick; reasonCode = "ok"; clientOpId = "smoke-$rand" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$base/pick-lists/$plId/items/$lineId/scan" -Headers $whH -Body $scanBody | Out-Null
OK "scan-confirmed pick line"

try {
  $completed = Invoke-RestMethod -Method Post -Uri "$base/pick-lists/$plId/complete" -Headers $whH -Body "{}"
} catch {
  $r = $_.ErrorDetails.Message | ConvertFrom-Json
  Fail "pick-list complete returned $($_.Exception.Response.StatusCode): code=$($r.error.code) msg=$($r.error.message)"
}
# /complete returns { pickList, packingSlip } - the slip is auto-created.
if ($completed.pickList.status -ne "picked") { Fail "pick-list status='$($completed.pickList.status)', expected 'picked'" }
if (-not $completed.packingSlip) { Fail "no packing slip returned alongside completed pick" }
$slip = $completed.packingSlip
OK "pick list completed (status=picked); packing slip auto-created: $($slip.packingSlipNo) status=$($slip.status)"

# --- Auto-handoff: packer should equal the picker. -------------------
$pickerId = $completed.pickList.assignedToId
$packerId = $slip.assignedToId
if (-not $pickerId) { Fail "pick list has no assignedToId after complete - claim was not recorded" }
if (-not $packerId) { Fail "packing slip was created without an assignedToId; auto-handoff broke" }
if ($pickerId -ne $packerId) {
  Fail "packer ($packerId) does not match picker ($pickerId); auto-handoff broke"
}
OK "auto-handoff confirmed: picker $pickerId carried forward as packer"

# --- Ecommerce slips should land at status='invoiced' on pack, not
# 'packed'. Otherwise the desktop UI keeps offering "Generate invoice"
# and the next click 500s on Invoice.packingSlipId unique constraint. -

$packed = Invoke-RestMethod -Method Post -Uri "$base/packing-slips/$($slip.id)/pack" -Headers $whH -Body "{}"
if ($packed.status -ne "invoiced") { Fail "slip status='$($packed.status)', expected 'invoiced' for ecommerce SO" }
if (-not $packed.awb) { Fail "slip.awb missing - mock AWB hook did not fire" }
if ($packed.carrier -ne "MockCourier") { Fail "slip.carrier='$($packed.carrier)', expected 'MockCourier'" }
OK "ecommerce slip auto-invoiced with awb=$($packed.awb) carrier=$($packed.carrier)"

# --- Re-invoking /invoice on an already-invoiced slip must return the
# existing prepaid invoice, not 500 on the unique constraint. ----------
$reinv = Invoke-RestMethod -Method Post -Uri "$base/packing-slips/$($slip.id)/invoice" -Headers $whH -Body (@{ paymentMode = "upi" } | ConvertTo-Json)
if (-not $reinv.invoiceNo) { Fail "/invoice did not return an invoice for already-invoiced slip" }
if ($reinv.packingSlipId -ne $slip.id) { Fail "/invoice returned wrong invoice (packingSlipId mismatch)" }
OK "/invoice idempotent: returned $($reinv.invoiceNo) for already-invoiced slip"

# --- Invoice detail must expose the source + AWB so the desktop
# Billing screen can hide the in-house trip-assign block and show the
# courier handoff strip instead. -----------------------------------
$invDetail = Invoke-RestMethod -Method Get -Uri "$base/invoices/$($res.invoice.id)" -Headers $adminH
if ($invDetail.salesOrder.source -ne "ecommerce") {
  Fail "invoice detail: salesOrder.source='$($invDetail.salesOrder.source)', expected 'ecommerce'"
}
if (-not $invDetail.packingSlip.awb) {
  Fail "invoice detail: packingSlip.awb is empty - Billing UI cannot show courier strip"
}
if ($invDetail.packingSlip.carrier -ne "MockCourier") {
  Fail "invoice detail: packingSlip.carrier='$($invDetail.packingSlip.carrier)', expected 'MockCourier'"
}
OK "invoice detail exposes source=ecommerce + awb=$($invDetail.packingSlip.awb) (carrier=$($invDetail.packingSlip.carrier))"

# --- Courier catalogue + assign-courier + confirm-delivery ----------
Write-Host "--- courier reassign + delivery ---" -ForegroundColor Cyan
$couriers = Invoke-RestMethod -Method Get -Uri "$base/couriers" -Headers $adminH
if (-not $couriers -or $couriers.Count -lt 2) { Fail "/couriers returned empty list" }
OK "courier catalogue: $($couriers.Count) couriers ($($couriers[0].name), …)"

# Re-assign to Blue Dart with a typed AWB - operator override flow.
$reassignBody = @{ courier = "bluedart"; awb = "BD-$rand-001" } | ConvertTo-Json
$reassigned = Invoke-RestMethod -Method Post -Uri "$base/packing-slips/$($slip.id)/assign-courier" -Headers $adminH -Body $reassignBody
if ($reassigned.carrier -ne "Blue Dart") { Fail "assign-courier: carrier='$($reassigned.carrier)', expected 'Blue Dart'" }
if ($reassigned.awb -ne "BD-$rand-001") { Fail "assign-courier: awb='$($reassigned.awb)', expected 'BD-$rand-001'" }
if (-not $reassigned.trackingUrl) { Fail "assign-courier: trackingUrl is empty" }
if (-not $reassigned.dispatchedAt) { Fail "assign-courier: dispatchedAt was not stamped" }
OK "courier re-assigned: $($reassigned.carrier) AWB=$($reassigned.awb) trackingUrl=$($reassigned.trackingUrl)"

# Operator-typed AWB should be reflected on the invoice detail too.
$invDetail2 = Invoke-RestMethod -Method Get -Uri "$base/invoices/$($res.invoice.id)" -Headers $adminH
if ($invDetail2.packingSlip.awb -ne "BD-$rand-001") {
  Fail "invoice detail: packingSlip.awb='$($invDetail2.packingSlip.awb)' did not refresh after reassign"
}
if ($invDetail2.packingSlip.carrier -ne "Blue Dart") {
  Fail "invoice detail: packingSlip.carrier='$($invDetail2.packingSlip.carrier)' did not refresh after reassign"
}
OK "invoice detail refreshed with re-assigned courier"

# Confirm delivery, expect deliveredAt to be set.
$delivered = Invoke-RestMethod -Method Post -Uri "$base/packing-slips/$($slip.id)/confirm-delivery" -Headers $adminH -Body "{}"
if (-not $delivered.deliveredAt) { Fail "confirm-delivery: deliveredAt not stamped" }
OK "delivery confirmed: deliveredAt=$($delivered.deliveredAt)"

# Calling confirm-delivery again should be idempotent (no error).
$deliveredAgain = Invoke-RestMethod -Method Post -Uri "$base/packing-slips/$($slip.id)/confirm-delivery" -Headers $adminH -Body "{}"
if ($deliveredAgain.deliveredAt -ne $delivered.deliveredAt) {
  Fail "confirm-delivery: deliveredAt changed on second call (expected idempotent)"
}
OK "confirm-delivery is idempotent"

Write-Host ""
Write-Host "ALL STOREFRONT MOCK CHECKS PASSED" -ForegroundColor Green
