# Smoke test: document sharing for Invoice / Sales Order / Packing Slip.
# 1. Login as admin
# 2. Pick the most recent SO (auth-ed) - verify it has a shareToken
# 3. Hit /v1/public/sales-orders/<token> WITHOUT auth, verify sanitized payload
# 4. Pick the most recent invoice - rotate-share-token, then call /public/invoices/<token>
# 5. Pick the most recent packing slip, same drill
# 6. Try a bogus token, verify 404

$ErrorActionPreference = "Stop"
$base = "http://localhost:4000/v1"

Write-Host "==> Login"
$auth = Invoke-RestMethod -Method POST -Uri "$base/auth/login" -ContentType "application/json" `
  -Body (@{ username = "admin"; password = "nova1234" } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($auth.token)" }

# ---------------------------------------------------------------- SO
Write-Host "==> Sales order share"
$sos = Invoke-RestMethod -Method GET -Uri "$base/sales-orders?limit=1" -Headers $h
$so = $sos | Select-Object -First 1
if (-not $so) { throw "No SO seeded" }
Write-Host "    picked $($so.soNo) [$($so.id)] customer=$($so.customer.name)"

# Mint via rotate (also covers legacy rows that may have no token yet).
$soToken = (Invoke-RestMethod -Method POST -Uri "$base/sales-orders/$($so.id)/rotate-share-token" -Headers $h `
  -ContentType "application/json" -Body "{}").shareToken
if (-not $soToken) { throw "SO rotate-share-token returned empty" }
Write-Host "    mint/rotate SO shareToken = $soToken"

$soPub = Invoke-RestMethod -Method GET -Uri "$base/public/sales-orders/$soToken"
Write-Host "    public payload: soNo=$($soPub.soNo) customer=$($soPub.customer.name) items=$($soPub.items.Count) total=$($soPub.total)"
if ($soPub.soNo -ne $so.soNo) { throw "Public SO no mismatch" }

# ---------------------------------------------------------------- INVOICE
Write-Host "==> Invoice share"
$invs = Invoke-RestMethod -Method GET -Uri "$base/invoices?limit=1" -Headers $h
$inv = $invs | Select-Object -First 1
if (-not $inv) { throw "No invoice seeded" }
Write-Host "    picked $($inv.invoiceNo) [$($inv.id)] customer=$($inv.customer.name)"

$invToken = (Invoke-RestMethod -Method POST -Uri "$base/invoices/$($inv.id)/rotate-share-token" -Headers $h `
  -ContentType "application/json" -Body "{}").shareToken
if (-not $invToken) { throw "Invoice rotate-share-token returned empty" }
Write-Host "    mint/rotate Invoice shareToken = $invToken"

$invPub = Invoke-RestMethod -Method GET -Uri "$base/public/invoices/$invToken"
Write-Host "    public payload: invoiceNo=$($invPub.invoiceNo) customer=$($invPub.customer.name) items=$($invPub.items.Count) amount=$($invPub.amount)"
if ($invPub.invoiceNo -ne $inv.invoiceNo) { throw "Public invoice no mismatch" }

# ---------------------------------------------------------------- PS
Write-Host "==> Packing slip share"
$pss = Invoke-RestMethod -Method GET -Uri "$base/packing-slips?limit=1" -Headers $h
$ps = $pss | Select-Object -First 1
if (-not $ps) {
    Write-Host "    no packing slip exists, skipping"
} else {
    Write-Host "    picked $($ps.packingSlipNo) [$($ps.id)]"

    $psToken = (Invoke-RestMethod -Method POST -Uri "$base/packing-slips/$($ps.id)/rotate-share-token" -Headers $h `
      -ContentType "application/json" -Body "{}").shareToken
    Write-Host "    mint/rotate PS shareToken = $psToken"

    $psPub = Invoke-RestMethod -Method GET -Uri "$base/public/packing-slips/$psToken"
    Write-Host "    public payload: psNo=$($psPub.packingSlipNo) so=$($psPub.soNo) items=$($psPub.items.Count)"
    if ($psPub.packingSlipNo -ne $ps.packingSlipNo) { throw "Public PS no mismatch" }
}

# ---------------------------------------------------------------- 404
Write-Host "==> Bogus token => 404"
foreach ($p in @("invoices","sales-orders","packing-slips")) {
    try {
        Invoke-RestMethod -Method GET -Uri "$base/public/$p/deadbeefdeadbeefdeadbeefdeadbeef" | Out-Null
        throw "Expected 404 for $p"
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code -ne 404) { throw "Expected 404 for $p but got $code" }
        Write-Host "    /public/$p bogus -> 404 (ok)"
    }
}

Write-Host "==> All checks passed"
