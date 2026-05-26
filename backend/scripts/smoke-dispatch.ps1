# Smoke test: issue a transport order against an invoice.
# 1. Login
# 2. Find a non-draft invoice
# 3. GET /v1/invoices/:id, verify items + dispatches array
# 4. POST /v1/dispatches with that invoice id, verify DSP-2026-NNNN doc no
# 5. Re-fetch invoice, verify the new dispatch shows up
# 6. Confirm the dispatch (POST /dispatches/:id/confirm), verify status=delivered
# 7. POST /v1/dispatches with a draft invoice, expect 409

$ErrorActionPreference = "Stop"
$base = "http://localhost:4000/v1"

Write-Host "==> Login"
$auth = Invoke-RestMethod -Method POST -Uri "$base/auth/login" -ContentType "application/json" `
  -Body (@{ username = "admin"; password = "nova1234" } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($auth.token)" }

Write-Host "==> Find an issued invoice"
$invs = Invoke-RestMethod -Method GET -Uri "$base/invoices" -Headers $h
$inv = $invs | Where-Object { $_.status -ne "draft" } | Select-Object -First 1
if (-not $inv) { throw "No non-draft invoice exists." }
Write-Host "    picked $($inv.invoiceNo) [$($inv.id)] customer=$($inv.customer.name) amount=$($inv.amount)"

Write-Host "==> GET /v1/invoices/:id detail"
$detail = Invoke-RestMethod -Method GET -Uri "$base/invoices/$($inv.id)" -Headers $h
Write-Host "    items=$($detail.items.Count) dispatches=$($detail.dispatches.Count)"
$priorCount = $detail.dispatches.Count

Write-Host "==> POST /v1/dispatches"
$disp = Invoke-RestMethod -Method POST -Uri "$base/dispatches" -Headers $h `
  -ContentType "application/json" -Body (@{
    invoiceId = $inv.id
    vehicle = "KA-01-AB-1234"
    driver = "Rajesh Kumar"
    destination = "Bangalore HQ"
    etaHours = 12
    weightKg = 250
  } | ConvertTo-Json)
Write-Host "    created $($disp.dispatchNo) [$($disp.id)] -> $($disp.destination)"
if ($disp.dispatchNo -notmatch "^DSP-2026-\d{4}$") { throw "Bad dispatchNo format: $($disp.dispatchNo)" }

Write-Host "==> Re-fetch invoice, verify dispatch attached"
$detail2 = Invoke-RestMethod -Method GET -Uri "$base/invoices/$($inv.id)" -Headers $h
Write-Host "    dispatches now: $($detail2.dispatches.Count) (was $priorCount)"
if ($detail2.dispatches.Count -ne ($priorCount + 1)) { throw "Dispatch count did not grow" }
$attached = $detail2.dispatches | Where-Object { $_.id -eq $disp.id } | Select-Object -First 1
if (-not $attached) { throw "Newly created dispatch not in invoice.dispatches" }

Write-Host "==> Confirm delivery"
$confirmed = Invoke-RestMethod -Method POST -Uri "$base/dispatches/$($disp.id)/confirm" -Headers $h `
  -ContentType "application/json" -Body "{}"
if ($confirmed.status -ne "delivered") { throw "Expected delivered, got $($confirmed.status)" }
Write-Host "    status=$($confirmed.status) signedAt=$($confirmed.signedAt)"

Write-Host "==> Reject when invoice is in draft"
# Create a draft invoice via the POS endpoint, but POST /invoices auto-issues.
# Instead, find or simulate one. The current /invoices POST sets status=issued,
# so we'll skip this part if no draft exists.
$draft = $invs | Where-Object { $_.status -eq "draft" } | Select-Object -First 1
if ($draft) {
    try {
        Invoke-RestMethod -Method POST -Uri "$base/dispatches" -Headers $h `
          -ContentType "application/json" -Body (@{
            invoiceId = $draft.id
            vehicle = "X"
            driver = "Y"
          } | ConvertTo-Json) | Out-Null
        throw "Expected 409 for draft invoice"
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code -ne 409) { throw "Expected 409 for draft, got $code" }
        Write-Host "    draft invoice rejected with 409 (ok)"
    }
} else {
    Write-Host "    no draft invoice exists - skipping rejection check"
}

Write-Host "==> All checks passed"
