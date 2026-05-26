# Smoke test for Customer master CRUD.
#
# Verifies:
#   1. GET /customers returns active customers by default and ?includeInactive=1
#      returns inactive ones too.
#   2. POST /customers without `code` auto-generates a CUST-#### code, and
#      with a duplicate code returns 409.
#   3. PATCH /customers/:id updates fields (name, creditLimit, priceListId).
#   4. DELETE /customers/:id hard-deletes when no history; soft-deletes
#      (sets active=false, returns softDeleted=true) when there is history.

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

Show-Section "Read price lists for FK reference"
$pls = Invoke-RestMethod -Uri "$base/price-lists" -Headers $hdr
Assert ($pls.Count -gt 0) "found $($pls.Count) price list(s)"
$pl = $pls[0]

Show-Section "List customers (active only)"
$activeCs = Invoke-RestMethod -Uri "$base/customers" -Headers $hdr
$activeCount = @($activeCs).Count
Write-Host "  initial active count: $activeCount"

# Clean leftover smoke-test rows from a previous failed run so we can replay
# the test idempotently.
$leftovers = Invoke-RestMethod -Uri "$base/customers?includeInactive=1" -Headers $hdr
$leftovers | Where-Object { $_.code -like "SMOKE-*" -or $_.name -like "Smoke Customer*" } | ForEach-Object {
  try { Invoke-RestMethod -Uri "$base/customers/$($_.id)" -Method DELETE -Headers $hdr | Out-Null } catch {}
}

Show-Section "Create - auto-code, no priceList"
$bodyA = @{
  name        = "Smoke Customer A"
  city        = "Bengaluru"
  contact     = "ops@smoke-a.test"
  creditLimit = 0
} | ConvertTo-Json
$cA = Invoke-RestMethod -Uri "$base/customers" -Method POST -Headers $hdr `
  -ContentType "application/json" -Body $bodyA
Assert ($cA.id) "customer A created"
Assert ($cA.code -match "^CUST-\d{4}$") "auto-generated code looks like CUST-#### ($($cA.code))"
Assert ($cA.active -eq $true) "active=true by default"
Assert ($cA._count.quotes -eq 0) "_count.quotes=0"

Show-Section "Create - explicit code + price list"
$suffix = Get-Random -Minimum 1000 -Maximum 9999
$customCode = "SMOKE-$suffix"
$bodyB = @{
  code        = $customCode
  name        = "Smoke Customer B"
  gst         = "29ABCDE1234F2Z5"
  city        = "Mumbai"
  creditLimit = 250000
  priceListId = $pl.id
} | ConvertTo-Json
$cB = Invoke-RestMethod -Uri "$base/customers" -Method POST -Headers $hdr `
  -ContentType "application/json" -Body $bodyB
Assert ($cB.code -eq $customCode) "explicit code preserved ($($cB.code))"
Assert ($cB.priceList.id -eq $pl.id) "priceList linked"
Assert ($cB.creditLimit -eq 250000) "credit limit set"

Show-Section "Duplicate code rejected"
$dup = $null
try {
  $dup = Invoke-RestMethod -Uri "$base/customers" -Method POST -Headers $hdr `
    -ContentType "application/json" -Body (@{ code = $customCode; name = "Dup" } | ConvertTo-Json)
  Write-Host "FAIL: duplicate POST did not throw" -ForegroundColor Red
  exit 1
} catch {
  $resp = $_.ErrorDetails.Message
  Assert ($resp -like "*duplicate_code*") "duplicate code returns duplicate_code error ($resp)"
}

Show-Section "Update - change name + credit limit + price list"
$renamedName = 'Smoke Customer B [renamed]'
$updateBody = @{ name = $renamedName; creditLimit = 500000; priceListId = $null } | ConvertTo-Json
$updB = Invoke-RestMethod -Uri "$base/customers/$($cB.id)" -Method PATCH -Headers $hdr `
  -ContentType "application/json" -Body $updateBody
Assert ($updB.name -eq $renamedName) "name updated"
Assert ($updB.creditLimit -eq 500000) "creditLimit updated"
Assert ($null -eq $updB.priceList) "priceList cleared"

Show-Section "Hard-delete - no history"
$delA = Invoke-RestMethod -Uri "$base/customers/$($cA.id)" -Method DELETE -Headers $hdr
Assert ($delA.softDeleted -eq $false) "A hard-deleted (softDeleted=false)"

# Confirm A is gone
try {
  Invoke-RestMethod -Uri "$base/customers/$($cA.id)" -Headers $hdr | Out-Null
  Write-Host "FAIL: A still readable after hard-delete" -ForegroundColor Red
  exit 1
} catch {
  Assert ($true) "A is no longer readable"
}

Show-Section "Soft-delete - give B a quote first"
$prods = Invoke-RestMethod -Uri "$base/products?limit=10" -Headers $hdr
$p = $prods | Where-Object { $_.sellingPrice -gt 0 } | Select-Object -First 1
$validUntil = (Get-Date).AddDays(30).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$qB = Invoke-RestMethod -Uri "$base/quotes" -Method POST -Headers $hdr `
  -ContentType "application/json" -Body (@{
    customerId   = $cB.id
    validUntil   = $validUntil
    paymentTerms = "Net 30"
    items        = @(@{ productId = $p.id; qty = 1; rate = $p.sellingPrice; discount = 0 })
  } | ConvertTo-Json -Depth 5)
Assert ($qB.quoteNo) "quote created against customer B ($($qB.quoteNo))"

$delB = Invoke-RestMethod -Uri "$base/customers/$($cB.id)" -Method DELETE -Headers $hdr
Assert ($delB.softDeleted -eq $true) "B soft-deleted (softDeleted=true)"
Assert ($delB.customer.active -eq $false) "B.active=false"
Assert ($delB.message -like "*linked transaction*") "explanation message mentions linked transactions"

Show-Section "Cleanup the draft quote so it doesn't dangle"
# Drafts have no audit history, so we hard-delete them. Without this, every
# smoke run would leave behind an orphan draft pointing to the inactive
# customer, which the Quote editor cannot save against.
Invoke-RestMethod -Uri "$base/quotes/$($qB.id)" -Method DELETE -Headers $hdr | Out-Null
Assert ($true) "draft quote $($qB.quoteNo) deleted"

Show-Section "Active filter respects soft-delete"
$activeAfter = Invoke-RestMethod -Uri "$base/customers" -Headers $hdr
$activeAfterIds = @($activeAfter | ForEach-Object { $_.id })
Assert (-not ($activeAfterIds -contains $cB.id)) "B hidden from active-only list"

$allAfter = Invoke-RestMethod -Uri "$base/customers?includeInactive=1" -Headers $hdr
$allAfterIds = @($allAfter | ForEach-Object { $_.id })
Assert ($allAfterIds -contains $cB.id) "B visible with includeInactive=1"

Show-Section "Reactivate B"
$reB = Invoke-RestMethod -Uri "$base/customers/$($cB.id)" -Method PATCH -Headers $hdr `
  -ContentType "application/json" -Body (@{ active = $true } | ConvertTo-Json)
Assert ($reB.active -eq $true) "B reactivated"

Show-Section "Cleanup: hard-delete B (its only quote was already removed)"
$finalDel = Invoke-RestMethod -Uri "$base/customers/$($cB.id)" -Method DELETE -Headers $hdr
Assert ($finalDel.softDeleted -eq $false) "B hard-deleted (no history left)"

Write-Host ""
Write-Host "All assertions passed" -ForegroundColor Green
