# PO share-link smoke test.
#
# Verifies:
#   1. /purchase-orders endpoint returns shareToken (null until minted).
#   2. POST /purchase-orders/:id/rotate-share-token mints a token.
#   3. GET /public/purchase-orders/:token returns sanitised payload
#      with vendor + items, no internal IDs.
#   4. Rotating the token revokes the previous one (404 on old token).
#   5. /public/purchase-orders/<random> returns 404.

$ErrorActionPreference = "Stop"
$base = "http://localhost:4000/v1"
$suffix = "{0:x}" -f (Get-Random)
function MakeHeaders { param([string]$tok) @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" } }
function Fail { param($m) Write-Host "FAIL: $m" -ForegroundColor Red; exit 1 }
function OK   { param($m) Write-Host "OK:   $m" -ForegroundColor Green }

$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType "application/json" -Body (@{ username = "admin"; password = "nova1234" } | ConvertTo-Json)
$h = MakeHeaders $login.token

# ---------- fixture: vendor + approved PO ----------
$vendor = Invoke-RestMethod -Method Post -Uri "$base/vendors" -Headers $h -Body (@{
  name = "Share Vendor $suffix"; city = "Pune"; contact = "+91 9000000000"
  email = "ar@share-$suffix.test"; rating = 4.0
} | ConvertTo-Json)
$prods = Invoke-RestMethod -Method Get -Uri "$base/products?limit=2" -Headers $h
if ($prods.Count -lt 1) { Fail "no products" }
$po = Invoke-RestMethod -Method Post -Uri "$base/purchase-orders" -Headers $h -Body (@{
  vendorId = $vendor.id
  expectedDate = (Get-Date).AddDays(7).ToString("yyyy-MM-ddTHH:mm:ssZ")
  notes = "Share smoke"
  items = @(@{ productId = $prods[0].id; qty = 4; rate = 250 })
} | ConvertTo-Json -Depth 5)
Invoke-RestMethod -Method Post -Uri "$base/purchase-orders/$($po.id)/approve" -Headers $h -Body "{}" | Out-Null
OK "Fixture PO $($po.poNo) approved"

# ---------- 1. listing returns shareToken (null) ----------
$list = Invoke-RestMethod -Method Get -Uri "$base/purchase-orders" -Headers $h
$row = $list | Where-Object { $_.id -eq $po.id }
if (-not ($row.PSObject.Properties.Name -contains "shareToken")) {
  Fail "list endpoint did not return shareToken column"
}
if ($row.shareToken) { Fail "expected shareToken=null on freshly created PO" }
OK "List endpoint exposes shareToken (null pre-mint)"

# ---------- 2. mint token ----------
$mint = Invoke-RestMethod -Method Post -Uri "$base/purchase-orders/$($po.id)/rotate-share-token" -Headers $h -Body "{}"
if (-not $mint.shareToken) { Fail "rotate did not return a token" }
$tok1 = $mint.shareToken
if ($tok1.Length -lt 16) { Fail "token too short ($($tok1.Length))" }
OK "Minted token ($($tok1.Length) chars)"

# ---------- 3. public fetch works without auth ----------
$pub = Invoke-RestMethod -Method Get -Uri "$base/public/purchase-orders/$tok1"
if ($pub.poNo -ne $po.poNo)        { Fail "poNo mismatch in public payload" }
if ($pub.amount -ne 1000)          { Fail "amount mismatch (expected 1000, got $($pub.amount))" }
if ($pub.vendor.name -ne $vendor.name) { Fail "vendor name mismatch" }
if ($pub.items.Count -ne 1)        { Fail "expected 1 item in public payload" }
if ($pub.PSObject.Properties.Name -contains "vendorId") {
  Fail "public payload should not leak internal vendorId"
}
OK "Public payload looks good (vendor=$($pub.vendor.name), items=$($pub.items.Count))"

# ---------- 4. rotation revokes the old link ----------
$mint2 = Invoke-RestMethod -Method Post -Uri "$base/purchase-orders/$($po.id)/rotate-share-token" -Headers $h -Body "{}"
$tok2 = $mint2.shareToken
if ($tok2 -eq $tok1) { Fail "rotation returned same token" }

$revoked = $false
try {
  Invoke-RestMethod -Method Get -Uri "$base/public/purchase-orders/$tok1" | Out-Null
} catch {
  if ($_.Exception.Response.StatusCode.value__ -eq 404) { $revoked = $true }
}
if (-not $revoked) { Fail "old token still valid after rotation" }
OK "Old token returns 404 after rotation"

$pub2 = Invoke-RestMethod -Method Get -Uri "$base/public/purchase-orders/$tok2"
if ($pub2.poNo -ne $po.poNo) { Fail "new token did not return PO" }
OK "New token works"

# ---------- 5. random gibberish 404s ----------
$gibberish = $false
try {
  Invoke-RestMethod -Method Get -Uri "$base/public/purchase-orders/deadbeefdeadbeefdeadbeef" | Out-Null
} catch {
  if ($_.Exception.Response.StatusCode.value__ -eq 404) { $gibberish = $true }
}
if (-not $gibberish) { Fail "random token did not 404" }
OK "Random token correctly 404s"

Write-Host "ALL TESTS PASSED" -ForegroundColor Green
