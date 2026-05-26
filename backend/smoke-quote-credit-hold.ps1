# Smoke test for the credit-hold quote -> sales-order flow.
#
# Verifies:
#   1. Submitting + accepting a quote whose total exceeds the customer's
#      credit limit returns HTTP 202 with creditHold=true and DOES NOT
#      create a Sales Order.
#   2. GET /quotes/:id surfaces the pending Credit Limit approval so the UI
#      can render the credit-hold banner.
#   3. Granting the approval via /approvals/:id/decide materialises the SO
#      and returns { approval, salesOrder }.
#   4. POST /quotes/:id/force-convert (admin override) bypasses the gate
#      and creates the SO directly, marking the approval approved.

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

Show-Section "Pick a 0-credit-limit customer"
$cs = Invoke-RestMethod -Uri "$base/customers" -Headers $hdr
$cust = $cs | Where-Object { $_.creditLimit -eq 0 } | Select-Object -First 1
Assert ($null -ne $cust) "found cash-only customer ($($cust.name))"

Show-Section "Build a quote payload"
$prods = Invoke-RestMethod -Uri "$base/products?limit=20" -Headers $hdr
$p = $prods | Where-Object { $_.sellingPrice -gt 100 } | Select-Object -First 1
Assert ($null -ne $p) "found a sellable product ($($p.sku))"
$validUntil = (Get-Date).AddDays(30).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$qBody = @{
  customerId   = $cust.id
  validUntil   = $validUntil
  paymentTerms = "Net 30"
  items        = @(
    @{ productId = $p.id; qty = 5; rate = $p.sellingPrice; discount = 0 }
  )
} | ConvertTo-Json -Depth 5

Show-Section "Path A: credit-hold parking"
$qA = Invoke-RestMethod -Uri "$base/quotes" -Method POST -Headers $hdr `
  -ContentType "application/json" -Body $qBody
Assert ($qA.status -eq "draft") "Quote A created in draft ($($qA.quoteNo))"

$qA = Invoke-RestMethod -Uri "$base/quotes/$($qA.id)/submit" `
  -Method POST -Headers $hdr -ContentType "application/json" -Body "{}"
Assert ($qA.status -eq "submitted") "Quote A submitted"

# Acceptance must return 202 (creditHold) when limit is breached.
$accept = $null
try {
  $accept = Invoke-RestMethod -Uri "$base/quotes/$($qA.id)/accept" `
    -Method POST -Headers $hdr -ContentType "application/json" -Body "{}"
} catch {
  Write-Host "Accept threw: $($_.Exception.Message)" -ForegroundColor Red
  throw
}
Assert ($accept.creditHold -eq $true) "accept returns creditHold=true"
Assert ([string]::IsNullOrEmpty($accept.soNo)) "no SO created"
Assert ($accept.approvalId) "approval id returned ($($accept.approvalId.Substring($accept.approvalId.Length-6)))"

# GET /quotes/:id should now surface pendingApproval
$qDetail = Invoke-RestMethod -Uri "$base/quotes/$($qA.id)" -Headers $hdr
Assert ($qDetail.status -eq "accepted") "quote status='accepted'"
Assert ([string]::IsNullOrEmpty($qDetail.convertedSalesOrderId)) "no convertedSalesOrderId"
Assert ($null -ne $qDetail.pendingApproval) "pendingApproval surfaced"
Assert ($qDetail.pendingApproval.id -eq $accept.approvalId) "approval id matches"
Assert ($qDetail.pendingApproval.status -eq "pending") "approval is pending"

Show-Section "Path A: granting the approval materialises the SO"
$decide = Invoke-RestMethod -Uri "$base/approvals/$($accept.approvalId)/decide" `
  -Method POST -Headers $hdr -ContentType "application/json" `
  -Body (@{ decision = "approved" } | ConvertTo-Json)
Assert ($null -ne $decide.salesOrder) "decide returns salesOrder"
Assert ($decide.salesOrder.soNo.StartsWith("SO-")) "SO no looks valid ($($decide.salesOrder.soNo))"

$qDetail2 = Invoke-RestMethod -Uri "$base/quotes/$($qA.id)" -Headers $hdr
Assert ($qDetail2.status -eq "converted") "quote status flipped to 'converted'"
Assert ($qDetail2.convertedSalesOrderId -eq $decide.salesOrder.id) "convertedSalesOrderId set"
Assert ($null -eq $qDetail2.pendingApproval) "pendingApproval cleared"

Show-Section "Path B: admin force-convert"
$qB = Invoke-RestMethod -Uri "$base/quotes" -Method POST -Headers $hdr `
  -ContentType "application/json" -Body $qBody
$qB = Invoke-RestMethod -Uri "$base/quotes/$($qB.id)/submit" `
  -Method POST -Headers $hdr -ContentType "application/json" -Body "{}"
$accept2 = Invoke-RestMethod -Uri "$base/quotes/$($qB.id)/accept" `
  -Method POST -Headers $hdr -ContentType "application/json" -Body "{}"
Assert ($accept2.creditHold -eq $true) "Quote B parked on credit hold"

$force = Invoke-RestMethod -Uri "$base/quotes/$($qB.id)/force-convert" `
  -Method POST -Headers $hdr -ContentType "application/json" `
  -Body (@{ reason = "Smoke test override" } | ConvertTo-Json)
Assert ($force.forced -eq $true) "force-convert succeeded"
Assert ($null -ne $force.salesOrder) "force-convert returned salesOrder"
Assert ($force.salesOrder.soNo.StartsWith("SO-")) "SO no looks valid ($($force.salesOrder.soNo))"
Assert ($force.approvalId -eq $accept2.approvalId) "approval id matches the parked one"

# The previously pending approval must now be 'approved' for audit trail.
$apps = Invoke-RestMethod -Uri "$base/approvals?status=approved" -Headers $hdr
$resolved = $apps | Where-Object { $_.id -eq $accept2.approvalId }
Assert ($null -ne $resolved) "parked approval is recorded as approved"

$qBdetail = Invoke-RestMethod -Uri "$base/quotes/$($qB.id)" -Headers $hdr
Assert ($qBdetail.status -eq "converted") "Quote B status='converted'"
Assert ($qBdetail.convertedSalesOrderId -eq $force.salesOrder.id) "Quote B linked to SO"

Show-Section "Path C: idempotency - accept on already-converted quote"
$accept3 = Invoke-RestMethod -Uri "$base/quotes/$($qB.id)/accept" `
  -Method POST -Headers $hdr -ContentType "application/json" -Body "{}"
Assert ($accept3.alreadyConverted -eq $true) "second accept returns alreadyConverted"

Write-Host ""
Write-Host "All assertions passed" -ForegroundColor Green
