# Credit-limit rejection -> quote bounce smoke test.
#
# Verifies:
#   1. Accepting a quote that breaches the credit limit parks an
#      Approval (type=Credit Limit) and freezes the quote in 'accepted'.
#   2. Rejecting that approval flips the quote to 'rejected', stamps
#      rejectedAt, and appends the reason to quote.notes.
#   3. The approval row records the decision reason on its `reason`
#      column for audit.
#
# Idempotent across runs: customer + quote use a random suffix.

$ErrorActionPreference = "Stop"
$base = "http://localhost:4000/v1"
$suffix = "{0:x}" -f (Get-Random)
function MakeHeaders { param([string]$tok) @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" } }
function Fail { param($m) Write-Host "FAIL: $m" -ForegroundColor Red; exit 1 }
function OK   { param($m) Write-Host "OK:   $m" -ForegroundColor Green }

$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType "application/json" -Body (@{ username = "admin"; password = "nova1234" } | ConvertTo-Json)
$h = MakeHeaders $login.token

# 1. Cash-only customer (creditLimit=0 => any non-zero balance breaches).
$cust = Invoke-RestMethod -Method Post -Uri "$base/customers" -Headers $h -Body (@{
  name = "CreditReject Test $suffix"
  city = "Bengaluru"
  contact = "9999999999"
  creditLimit = 0
} | ConvertTo-Json)
OK "Created customer $($cust.code)"

# 2. Pick any active product+variant the seller can quote.
$prods = Invoke-RestMethod -Method Get -Uri "$base/products?limit=200" -Headers $h
$prodWithVariant = $prods | Where-Object { @($_.variants).Count -gt 0 -and ($_.variants | Where-Object { $_.active })} | Select-Object -First 1
if (-not $prodWithVariant) { Fail "no product with active variants found in catalog" }
$variant = ($prodWithVariant.variants | Where-Object { $_.active })[0]
OK "Quoting $($prodWithVariant.sku)/$($variant.sku)"

# 3. Create a draft quote for a non-zero amount.
$validUntil = (Get-Date).AddDays(15).ToString("yyyy-MM-ddTHH:mm:ssZ")
$quote = Invoke-RestMethod -Method Post -Uri "$base/quotes" -Headers $h -Body (@{
  customerId = $cust.id
  validUntil = $validUntil
  items = @(@{
    productId = $prodWithVariant.id
    variantId = $variant.id
    qty = 5
    rate = 1000
    discount = 0
  })
} | ConvertTo-Json -Depth 5)
OK "Created quote $($quote.quoteNo) (status=$($quote.status), total=$($quote.total))"

# 4. Submit it.
Invoke-RestMethod -Method Post -Uri "$base/quotes/$($quote.id)/submit" -Headers $h -Body "{}" | Out-Null
$qSubmitted = Invoke-RestMethod -Method Get -Uri "$base/quotes/$($quote.id)" -Headers $h
if ($qSubmitted.status -ne "submitted") { Fail "quote submit didn't move to 'submitted', got '$($qSubmitted.status)'" }
OK "Quote moved to 'submitted'"

# 5. Accept the quote -> credit breach should park an Approval.
$accept = Invoke-RestMethod -Method Post -Uri "$base/quotes/$($quote.id)/accept" -Headers $h -Body "{}"
if (-not $accept.creditHold) { Fail "expected creditHold=true on accept response, got $($accept | ConvertTo-Json -Compress)" }
$approvalId = $accept.approvalId
$qAfterAccept = Invoke-RestMethod -Method Get -Uri "$base/quotes/$($quote.id)" -Headers $h
if ($qAfterAccept.status -ne "accepted") { Fail "quote should be 'accepted' after credit-hold, got '$($qAfterAccept.status)'" }
OK "Approval $approvalId parked; quote sits at 'accepted'"

# 6. Reject the approval with a reason.
$rejectReason = "Customer hasn't cleared aged AR; deal on hold."
$rejectResp = Invoke-RestMethod -Method Post -Uri "$base/approvals/$approvalId/decide" -Headers $h -Body (@{
  decision = "rejected"
  reason = $rejectReason
} | ConvertTo-Json)

if (-not $rejectResp.approval) { Fail "decide response missing 'approval' wrapper, got $($rejectResp | ConvertTo-Json -Compress)" }
if (-not $rejectResp.quote)    { Fail "decide response missing 'quote' wrapper - the quote should have bounced" }
if ($rejectResp.approval.status -ne "rejected") { Fail "approval status should be 'rejected'" }
if ($rejectResp.quote.status   -ne "rejected") { Fail "quote status should be 'rejected', got '$($rejectResp.quote.status)'" }
if (-not $rejectResp.quote.rejectedAt) { Fail "rejectedAt timestamp missing on quote" }
if ($rejectResp.quote.notes -notmatch [regex]::Escape($rejectReason)) {
  Fail "quote.notes should contain the rejection reason, got '$($rejectResp.quote.notes)'"
}
if ($rejectResp.approval.reason -notmatch [regex]::Escape($rejectReason)) {
  Fail "approval.reason should be appended with the rejection note, got '$($rejectResp.approval.reason)'"
}
OK "Approval rejected; quote bounced to 'rejected' with rejectedAt + note"

# 7. Re-fetch the quote independently and confirm persistence.
$qFinal = Invoke-RestMethod -Method Get -Uri "$base/quotes/$($quote.id)" -Headers $h
if ($qFinal.status -ne "rejected") { Fail "re-fetched quote status is '$($qFinal.status)', expected 'rejected'" }
OK "Re-fetched quote confirms status='rejected'"

Write-Host "ALL TESTS PASSED" -ForegroundColor Green
