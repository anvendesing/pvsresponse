# Smoke test for the stock-availability guard on the issuance paths.
#
# Verifies:
#   1. POST /invoices refuses to create an invoice that would drive any
#      product/variant stockOnHand below zero (HTTP 409 insufficient_stock).
#   2. The refusal is surgical - state is unchanged after the failed call.
#   3. A right-sized invoice (qty <= stock) succeeds and decrements normally.
#   4. After a successful invoice, the new stockOnHand never drops below 0.
#   5. The reconcile-stock script reports drift but doesn't write anything
#      in dry-run mode.

$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:4000/v1"

function Show-Section($t) {
  Write-Host ""
  Write-Host "=== $t ===" -ForegroundColor Cyan
}

function Assert($cond, $msg) {
  if (-not $cond) {
    Write-Host "FAIL: $msg" -ForegroundColor Red
    exit 1
  } else {
    Write-Host "  ok: $msg" -ForegroundColor Green
  }
}

Show-Section "Login"
$login = Invoke-RestMethod -Uri "$base/auth/login" -Method POST `
  -ContentType "application/json" `
  -Body (@{ username = "admin"; password = "nova1234" } | ConvertTo-Json)
$hdr = @{ Authorization = "Bearer $($login.token)" }
Assert ($login.token.Length -gt 50) "token issued"

Show-Section "Pick a product with positive stock"
$prods = Invoke-RestMethod -Uri "$base/products?limit=500" -Headers $hdr
$p = $prods | Where-Object {
  $_.stockOnHand -gt 0 -and (@($_.variants).Count -eq 0)
} | Sort-Object -Property stockOnHand -Descending | Select-Object -First 1
Assert ($null -ne $p) "found a non-variant product with stock"
Write-Host "  using $($p.sku) stock=$($p.stockOnHand)"
$startStock = $p.stockOnHand

$cs = Invoke-RestMethod -Uri "$base/customers" -Headers $hdr
$cust = $cs | Where-Object { $_.creditLimit -gt 0 } | Select-Object -First 1
Assert ($null -ne $cust) "found customer with credit ($($cust.name))"

Show-Section "Oversell is rejected (qty = stock + 1)"
$badBody = @{
  customerId  = $cust.id
  paymentMode = "credit"
  items       = @(@{ productId = $p.id; qty = $startStock + 1; rate = $p.sellingPrice })
} | ConvertTo-Json -Depth 5
$rejected = $false
$reasonText = ""
try {
  Invoke-RestMethod -Uri "$base/invoices" -Method POST -Headers $hdr `
    -ContentType "application/json" -Body $badBody | Out-Null
} catch {
  $rejected = $true
  $reasonText = $_.ErrorDetails.Message
}
Assert ($rejected) "oversell rejected"
Assert ($reasonText -like "*insufficient_stock*") "error code is insufficient_stock"
Assert ($reasonText -like "*$($p.sku)*") "error mentions the SKU"
Assert ($reasonText -like "*$($startStock + 1)*") "error mentions requested qty"

Show-Section "Stock unchanged after rejection"
$pAfterFail = Invoke-RestMethod -Uri "$base/products/by-sku/$($p.sku)" -Headers $hdr
Assert ($pAfterFail.stockOnHand -eq $startStock) "stockOnHand unchanged ($($pAfterFail.stockOnHand) == $startStock)"

Show-Section "Aggregation across multiple lines is checked together"
# Send two lines for the same product, each within stock individually but
# combined exceeding stock. Must still reject.
$splitBody = @{
  customerId  = $cust.id
  paymentMode = "credit"
  items       = @(
    @{ productId = $p.id; qty = [Math]::Ceiling($startStock / 2) + 1; rate = $p.sellingPrice }
    @{ productId = $p.id; qty = [Math]::Ceiling($startStock / 2) + 1; rate = $p.sellingPrice }
  )
} | ConvertTo-Json -Depth 5
$rejected2 = $false
try {
  Invoke-RestMethod -Uri "$base/invoices" -Method POST -Headers $hdr `
    -ContentType "application/json" -Body $splitBody | Out-Null
} catch { $rejected2 = $true }
Assert ($rejected2) "two-line cumulative oversell rejected"
$pAfterFail2 = Invoke-RestMethod -Uri "$base/products/by-sku/$($p.sku)" -Headers $hdr
Assert ($pAfterFail2.stockOnHand -eq $startStock) "stockOnHand still unchanged"

Show-Section "Right-sized invoice succeeds"
$qty = [Math]::Min(2, $startStock)
$goodBody = @{
  customerId  = $cust.id
  paymentMode = "credit"
  items       = @(@{ productId = $p.id; qty = $qty; rate = $p.sellingPrice })
} | ConvertTo-Json -Depth 5
$inv = Invoke-RestMethod -Uri "$base/invoices" -Method POST -Headers $hdr `
  -ContentType "application/json" -Body $goodBody
Assert ($inv.invoiceNo) "invoice created ($($inv.invoiceNo))"
$pAfterOk = Invoke-RestMethod -Uri "$base/products/by-sku/$($p.sku)" -Headers $hdr
Assert ($pAfterOk.stockOnHand -eq ($startStock - $qty)) "stockOnHand decremented to $($pAfterOk.stockOnHand)"
Assert ($pAfterOk.stockOnHand -ge 0) "stockOnHand never negative"

Show-Section "Drain to zero, then refuse the next sale"
$remaining = $pAfterOk.stockOnHand
if ($remaining -gt 0) {
  $drainBody = @{
    customerId  = $cust.id
    paymentMode = "credit"
    items       = @(@{ productId = $p.id; qty = $remaining; rate = $p.sellingPrice })
  } | ConvertTo-Json -Depth 5
  Invoke-RestMethod -Uri "$base/invoices" -Method POST -Headers $hdr `
    -ContentType "application/json" -Body $drainBody | Out-Null
}
$pZero = Invoke-RestMethod -Uri "$base/products/by-sku/$($p.sku)" -Headers $hdr
Assert ($pZero.stockOnHand -eq 0) "drained to 0"

$rejected3 = $false
try {
  Invoke-RestMethod -Uri "$base/invoices" -Method POST -Headers $hdr `
    -ContentType "application/json" `
    -Body (@{
      customerId  = $cust.id
      paymentMode = "credit"
      items       = @(@{ productId = $p.id; qty = 1; rate = $p.sellingPrice })
    } | ConvertTo-Json -Depth 5) | Out-Null
} catch { $rejected3 = $true }
Assert ($rejected3) "selling at qty=1 against zero stock is rejected"
$pStillZero = Invoke-RestMethod -Uri "$base/products/by-sku/$($p.sku)" -Headers $hdr
Assert ($pStillZero.stockOnHand -eq 0) "stockOnHand is still 0 (no negatives)"

Show-Section "reconcile-stock dry-run reports drift, writes nothing"
$beforeLedger = (Invoke-RestMethod -Uri "$base/ledger?txnType=Adjust&limit=500" -Headers $hdr).Count
$dry = & npx tsx scripts/reconcile-stock.ts 2>&1 | Out-String
Assert ($dry -like "*Mode: DRY-RUN*") "dry-run mode reported"
Assert ($dry -like "*Parent stockOnHand drift*") "drift reported"
$afterLedger = (Invoke-RestMethod -Uri "$base/ledger?txnType=Adjust&limit=500" -Headers $hdr).Count
Assert ($afterLedger -eq $beforeLedger) "no ledger entries written in dry-run ($beforeLedger -> $afterLedger)"

Show-Section "Cleanup: restore stock drained by the test"
# Use the inventory-adjust endpoint to put units back. This writes a
# StockLedger row so the cleanup itself is auditable.
$wh = (Invoke-RestMethod -Uri "$base/warehouses" -Headers $hdr) | Select-Object -First 1
$adjBody = @{
  productId   = $p.id
  warehouseId = $wh.id
  qty         = $startStock
  reason      = "Smoke test cleanup: restoring qty drained by smoke-stock-guard.ps1"
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "$base/inventory/adjust" -Method POST -Headers $hdr `
  -ContentType "application/json" -Body $adjBody | Out-Null

# inventory/adjust currently only writes a ledger row - the actual product
# stockOnHand restore has to be done via the product PATCH endpoint.
$restore = @{ stockOnHand = $startStock } | ConvertTo-Json
Invoke-RestMethod -Uri "$base/products/$($p.id)" -Method PATCH -Headers $hdr `
  -ContentType "application/json" -Body $restore | Out-Null
$pRestored = Invoke-RestMethod -Uri "$base/products/by-sku/$($p.sku)" -Headers $hdr
Assert ($pRestored.stockOnHand -eq $startStock) "stock restored to $startStock"

Write-Host ""
Write-Host "All assertions passed" -ForegroundColor Green
