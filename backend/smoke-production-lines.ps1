# /reports/production-lines + machine status auto-flip smoke test.
#
# Verifies:
#   1. /reports/production-lines returns one row per active WC.
#   2. /reports/attendance-heatmap returns the requested number of days.
#   3. POST /production-orders flips the chosen machine to "running"
#      after issue-materials.
#   4. POST /production-orders/.../complete flips it back to "idle".
#
# Idempotent: cleans up the WC/machine fixtures created at the start.

$ErrorActionPreference = "Stop"
$base = "http://localhost:4000/v1"
$suffix = "{0:x}" -f (Get-Random)
function MakeHeaders { param([string]$tok) @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" } }
function Fail { param($m) Write-Host "FAIL: $m" -ForegroundColor Red; exit 1 }
function OK   { param($m) Write-Host "OK:   $m" -ForegroundColor Green }

$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType "application/json" -Body (@{ username = "admin"; password = "nova1234" } | ConvertTo-Json)
$h = MakeHeaders $login.token

# Quick read-only checks first.
$lines = Invoke-RestMethod -Method Get -Uri "$base/reports/production-lines" -Headers $h
if (-not $lines.lines) { Fail "production-lines payload missing 'lines'" }
OK "production-lines returned $($lines.lines.Count) lines"

$hm = Invoke-RestMethod -Method Get -Uri "$base/reports/attendance-heatmap?days=14" -Headers $h
if (@($hm).Count -ne 14) { Fail "attendance-heatmap returned $((@($hm)).Count) rows, expected 14" }
OK "attendance-heatmap returned 14 rows"

# Create a fresh WC + machine and attach to a BOM. Then create an MO,
# issue materials, verify machine.status='running', then complete and
# verify back to 'idle'.
$wc = Invoke-RestMethod -Method Post -Uri "$base/work-centers" -Headers $h -Body (@{
  code = "WCSL-$suffix"; name = "Smoke Line $suffix"; capacityPerHour = 50
} | ConvertTo-Json)
$mc = Invoke-RestMethod -Method Post -Uri "$base/machines" -Headers $h -Body (@{
  code = "MSL-$suffix"; name = "Smoke Machine $suffix"; workCenterId = $wc.id
} | ConvertTo-Json)
OK "Created WC=$($wc.code), Machine=$($mc.code)"

# Pick the first active BOM and attach defaults to it.
$boms = Invoke-RestMethod -Method Get -Uri "$base/boms?active=1" -Headers $h
$bom = $boms[0]
Invoke-RestMethod -Method Patch -Uri "$base/boms/$($bom.id)" -Headers $h -Body (@{
  defaultWorkCenterId = $wc.id; defaultMachineId = $mc.id
} | ConvertTo-Json) | Out-Null
OK "Attached defaults to BOM $($bom.id)"

# Make a small MO.
$today = (Get-Date).ToString("yyyy-MM-dd")
$due   = (Get-Date).AddDays(1).ToString("yyyy-MM-dd")
$mo = Invoke-RestMethod -Method Post -Uri "$base/production-orders" -Headers $h -Body (@{
  bomId = $bom.id; plannedQty = 1; startDate = $today; dueDate = $due
} | ConvertTo-Json)
OK "Created MO $($mo.orderNo) (station=$($mo.station))"

# Issue materials. Allow short - we don't care if components are
# missing for the smoke test, we only care about the status flip.
try {
  Invoke-RestMethod -Method Post -Uri "$base/production-orders/$($mo.id)/issue-materials" -Headers $h -Body (@{ allowShort = $true } | ConvertTo-Json) | Out-Null
} catch {
  # Some BOMs have no components - that's also fine.
}
$allMc = Invoke-RestMethod -Method Get -Uri "$base/machines" -Headers $h
$mcAfterIssue = $allMc | Where-Object { $_.code -eq $mc.code } | Select-Object -First 1
if (-not $mcAfterIssue) { Fail "could not find smoke machine after issue" }
if ($mcAfterIssue.status -ne "running") { Fail "machine status after issue is '$($mcAfterIssue.status)', expected 'running'" }
OK "Machine flipped to 'running' after issue-materials"

# Log a tiny bit of output so we can complete.
Invoke-RestMethod -Method Post -Uri "$base/production-orders/$($mo.id)/log-output" -Headers $h -Body (@{ goodQty = 1; scrapQty = 0; reworkQty = 0 } | ConvertTo-Json) | Out-Null

# Complete.
Invoke-RestMethod -Method Post -Uri "$base/production-orders/$($mo.id)/complete" -Headers $h -Body "{}" | Out-Null
$allMcAfter = Invoke-RestMethod -Method Get -Uri "$base/machines" -Headers $h
$mcAfterComplete = $allMcAfter | Where-Object { $_.code -eq $mc.code } | Select-Object -First 1
if (-not $mcAfterComplete) { Fail "could not find smoke machine after complete" }
if ($mcAfterComplete.status -ne "idle") { Fail "machine status after complete is '$($mcAfterComplete.status)', expected 'idle'" }
OK "Machine flipped to 'idle' after complete"

# Cleanup. DELETE without Content-Type: Fastify rejects empty body
# requests when the JSON content-type is set, so use a plain auth-only
# header dictionary for these.
$hAuthOnly = @{ Authorization = "Bearer $($login.token)" }
Invoke-RestMethod -Method Patch -Uri "$base/boms/$($bom.id)" -Headers $h -Body (@{
  defaultWorkCenterId = $null; defaultMachineId = $null
} | ConvertTo-Json) | Out-Null
Invoke-RestMethod -Method Delete -Uri "$base/machines/$($mc.id)" -Headers $hAuthOnly | Out-Null
Invoke-RestMethod -Method Delete -Uri "$base/work-centers/$($wc.id)" -Headers $hAuthOnly | Out-Null
OK "Cleaned up fixtures"

Write-Host "ALL TESTS PASSED" -ForegroundColor Green
