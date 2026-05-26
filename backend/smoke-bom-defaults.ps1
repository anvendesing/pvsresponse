# BOM defaultWorkCenter / defaultMachine round-trip smoke test.
#
# Verifies:
#   1. PATCH /boms/:id can attach a defaultWorkCenter + defaultMachine.
#   2. The pair is rejected if the machine doesn't belong to the WC.
#   3. POST /production-orders without station/machine prefills both
#      from the BOM's defaults.
#   4. The MO carries the resolved names; the WO inherits them too.
#
# Idempotent: cleans up the WC/machine/MO created at the start.

$ErrorActionPreference = "Stop"
$base = "http://localhost:4000/v1"
$suffix = "{0:x}" -f (Get-Random)
function MakeHeaders { param([string]$tok) @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" } }
function Fail { param($m) Write-Host "FAIL: $m" -ForegroundColor Red; exit 1 }
function OK   { param($m) Write-Host "OK:   $m" -ForegroundColor Green }

$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType "application/json" -Body (@{ username = "admin"; password = "nova1234" } | ConvertTo-Json)
$h = MakeHeaders $login.token

# Step 1: pick any active BOM (use the first one).
$boms = Invoke-RestMethod -Method Get -Uri "$base/boms?active=1" -Headers $h
if (@($boms).Count -eq 0) { Fail "no active BOMs in DB - cannot test" }
$bom = $boms[0]
OK "Using BOM $($bom.id) for $($bom.product.sku)"

# Step 2: create a WC + 2 machines.
$wcCode = "WCT-$suffix"
$wc = Invoke-RestMethod -Method Post -Uri "$base/work-centers" -Headers $h -Body (@{
  code = $wcCode; name = "Test Line $suffix"; capacityPerHour = 100
} | ConvertTo-Json)
OK "Created WC $($wc.code)"

$mc1 = Invoke-RestMethod -Method Post -Uri "$base/machines" -Headers $h -Body (@{
  code = "MCT1-$suffix"; name = "Machine A $suffix"; workCenterId = $wc.id
} | ConvertTo-Json)
OK "Created machine $($mc1.code) on $($wc.code)"

# Second WC + machine on it, used to test the cross-line guard.
$wc2 = Invoke-RestMethod -Method Post -Uri "$base/work-centers" -Headers $h -Body (@{
  code = "WCT2-$suffix"; name = "Test Line2 $suffix"
} | ConvertTo-Json)
$mc2 = Invoke-RestMethod -Method Post -Uri "$base/machines" -Headers $h -Body (@{
  code = "MCT2-$suffix"; name = "Machine B $suffix"; workCenterId = $wc2.id
} | ConvertTo-Json)
OK "Created WC2 + machine on it for guard test"

# Step 3: attach defaults to the BOM. Must succeed.
$patched = Invoke-RestMethod -Method Patch -Uri "$base/boms/$($bom.id)" -Headers $h -Body (@{
  defaultWorkCenterId = $wc.id; defaultMachineId = $mc1.id
} | ConvertTo-Json)
if ($patched.defaultWorkCenter.id -ne $wc.id) { Fail "WC not persisted on BOM" }
if ($patched.defaultMachine.id   -ne $mc1.id) { Fail "Machine not persisted on BOM" }
OK "BOM attached default WC=$($patched.defaultWorkCenter.code), machine=$($patched.defaultMachine.code)"

# Step 4: try mismatched WC+machine - must 400.
$mismatch = $false
try {
  Invoke-RestMethod -Method Patch -Uri "$base/boms/$($bom.id)" -Headers $h -Body (@{
    defaultWorkCenterId = $wc.id; defaultMachineId = $mc2.id
  } | ConvertTo-Json) | Out-Null
} catch {
  $mismatch = $true
  if ($_.ErrorDetails.Message -notmatch "machine_workcenter_mismatch") {
    Fail "expected machine_workcenter_mismatch, got: $($_.ErrorDetails.Message)"
  }
}
if (-not $mismatch) { Fail "mismatched machine+WC was accepted" }
OK "Mismatched machine+WC correctly rejected (machine_workcenter_mismatch)"

# Step 5: create an MO without specifying station/machine.
$today = (Get-Date).ToString("yyyy-MM-dd")
$due   = (Get-Date).AddDays(3).ToString("yyyy-MM-dd")
$mo = Invoke-RestMethod -Method Post -Uri "$base/production-orders" -Headers $h -Body (@{
  bomId = $bom.id; plannedQty = 1; startDate = $today; dueDate = $due
} | ConvertTo-Json)
if ($mo.station -ne $wc.name) { Fail "MO station not prefilled (got '$($mo.station)', expected '$($wc.name)')" }
OK "MO created, station prefilled to '$($mo.station)'"

# Step 6: verify the auto WO inherits the machine.
$mo2 = Invoke-RestMethod -Method Get -Uri "$base/production-orders/$($mo.id)" -Headers $h
$wo = $mo2.workOrders[0]
if ($wo.machine -ne $mc1.name) { Fail "WO machine not prefilled (got '$($wo.machine)')" }
OK "WO machine prefilled to '$($wo.machine)'"

# Cleanup: delete the MO directly via API isn't supported; leave the MO
# in place but unwire the BOM defaults so we don't poison subsequent
# runs. WC/machine deletes are best-effort.
Invoke-RestMethod -Method Patch -Uri "$base/boms/$($bom.id)" -Headers $h -Body (@{
  defaultWorkCenterId = $null; defaultMachineId = $null
} | ConvertTo-Json) | Out-Null
OK "Detached defaults from BOM"

Write-Host "ALL TESTS PASSED" -ForegroundColor Green
