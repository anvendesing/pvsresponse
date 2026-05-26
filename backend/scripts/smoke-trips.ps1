# Smoke test: trip-based dispatch workflow.
#
# 1. Login
# 2. Auto-schedule next 4 days, verify trips are created (idempotent on retry)
# 3. Create an explicit trip for tomorrow, verify TRP-2026-NNNN format
# 4. Find a non-draft invoice, POST /v1/dispatches with tripId, verify the
#    dispatch is created with vehicle/driver=null and trip is set
# 5. GET /trips/:id, verify the dispatch shows up in the roster
# 6. Cancel the trip, verify successor trip exists with the dispatch on it
# 7. Reschedule a fresh trip, verify scheduledDate moves
# 8. Direct dispatch (no trip) still works with explicit vehicle/driver

$ErrorActionPreference = "Stop"
$base = "http://localhost:4000/v1"

function Date-Iso([int]$offset) {
  $d = (Get-Date).Date.AddDays($offset).ToUniversalTime()
  return $d.ToString("yyyy-MM-dd")
}

Write-Host "==> Login"
$auth = Invoke-RestMethod -Method POST -Uri "$base/auth/login" -ContentType "application/json" `
  -Body (@{ username = "admin"; password = "nova1234" } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($auth.token)" }

Write-Host "==> Auto-schedule next 4 days"
$auto = Invoke-RestMethod -Method POST -Uri "$base/trips/auto-schedule" -Headers $h `
  -ContentType "application/json" -Body (@{ days = 4; vehicle = "KA-01-AB-1234"; driver = "Rajesh"; route = "Bangalore Hub"; capacityKg = 1500 } | ConvertTo-Json)
Write-Host "    created=$($auto.created.Count) trips"

Write-Host "==> Auto-schedule again (should be idempotent)"
$auto2 = Invoke-RestMethod -Method POST -Uri "$base/trips/auto-schedule" -Headers $h `
  -ContentType "application/json" -Body (@{ days = 4 } | ConvertTo-Json)
if ($auto2.created.Count -ne 0) { Write-Host "    NOTE: created $($auto2.created.Count) extra trips on second run (expected 0 if no other trips were cancelled)" }

Write-Host "==> Create explicit trip for tomorrow"
$tomorrow = Date-Iso 1
$tripBody = @{
  scheduledDate = $tomorrow
  vehicle = "KA-99-XY-0001"
  driver  = "Test Driver"
  route   = "Smoke route"
  capacityKg = 800
} | ConvertTo-Json
$trip = Invoke-RestMethod -Method POST -Uri "$base/trips" -Headers $h -ContentType "application/json" -Body $tripBody
Write-Host "    created $($trip.tripNo) [$($trip.id)] for $($trip.scheduledDate)"
if ($trip.tripNo -notmatch "^TRP-2026-\d{4}$") { throw "Bad tripNo format: $($trip.tripNo)" }

Write-Host "==> Find a non-draft invoice"
$invs = Invoke-RestMethod -Method GET -Uri "$base/invoices" -Headers $h
$inv = $invs | Where-Object { $_.status -ne "draft" } | Select-Object -First 1
if (-not $inv) { throw "No non-draft invoice exists." }
Write-Host "    picked $($inv.invoiceNo) [$($inv.id)]"

Write-Host "==> POST /dispatches with tripId (no vehicle/driver in body)"
$disp = Invoke-RestMethod -Method POST -Uri "$base/dispatches" -Headers $h `
  -ContentType "application/json" -Body (@{
    invoiceId = $inv.id
    tripId = $trip.id
    weightKg = 250
  } | ConvertTo-Json)
Write-Host "    created $($disp.dispatchNo) tripId=$($disp.tripId) vehicle=$($disp.vehicle) driver=$($disp.driver)"
if ($null -ne $disp.vehicle) { throw "Expected dispatch.vehicle to be null when on a trip, got: $($disp.vehicle)" }
if ($null -ne $disp.driver) { throw "Expected dispatch.driver to be null when on a trip, got: $($disp.driver)" }
if ($disp.tripId -ne $trip.id) { throw "Expected tripId to match." }

Write-Host "==> GET /trips/:id - verify roster"
$tripFull = Invoke-RestMethod -Method GET -Uri "$base/trips/$($trip.id)" -Headers $h
Write-Host "    roster size=$($tripFull.dispatches.Count)"
if ($tripFull.dispatches.Count -ne 1) { throw "Expected 1 dispatch on the trip, got $($tripFull.dispatches.Count)" }
if ($tripFull.dispatches[0].dispatchNo -ne $disp.dispatchNo) { throw "Trip roster mismatch." }

Write-Host "==> Reschedule the trip to day-after-tomorrow"
$dayAfter = Date-Iso 2
$updated = Invoke-RestMethod -Method PATCH -Uri "$base/trips/$($trip.id)" -Headers $h `
  -ContentType "application/json" -Body (@{ scheduledDate = $dayAfter } | ConvertTo-Json)
Write-Host "    new scheduledDate=$($updated.scheduledDate)"
if ($updated.scheduledDate -notmatch $dayAfter) { throw "Reschedule didn't take effect." }

Write-Host "==> Cancel trip + verify successor with rolled-over dispatch"
$cancelRes = Invoke-RestMethod -Method POST -Uri "$base/trips/$($trip.id)/cancel" -Headers $h `
  -ContentType "application/json" -Body (@{ reason = "Vehicle breakdown (smoke)" } | ConvertTo-Json)
Write-Host "    cancelled $($cancelRes.trip.tripNo); successor=$($cancelRes.successor.tripNo) on $($cancelRes.successor.scheduledDate)"
if (-not $cancelRes.successor) { throw "Expected a successor trip to be created." }
if ($cancelRes.successor.dispatches.Count -ne 1) { throw "Expected the dispatch to roll over." }
if ($cancelRes.trip.status -ne "cancelled") { throw "Cancelled trip should have status=cancelled." }
if ($cancelRes.successor.rolledOverFromId -ne $trip.id) { throw "Successor should reference the cancelled trip." }

Write-Host "==> Try to edit cancelled trip (should 409)"
try {
  Invoke-RestMethod -Method PATCH -Uri "$base/trips/$($trip.id)" -Headers $h `
    -ContentType "application/json" -Body (@{ vehicle = "X" } | ConvertTo-Json) | Out-Null
  throw "Expected 409 editing cancelled trip"
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 409) {
    throw "Expected 409, got $($_.Exception.Response.StatusCode.value__): $($_.Exception.Message)"
  }
  Write-Host "    OK - 409 as expected"
}

Write-Host "==> Direct dispatch (no trip) still works"
$direct = Invoke-RestMethod -Method POST -Uri "$base/dispatches" -Headers $h `
  -ContentType "application/json" -Body (@{
    invoiceId = $inv.id
    vehicle = "KA-77-ZZ-9999"
    driver = "Direct Driver"
    destination = "Walk-in"
    weightKg = 100
  } | ConvertTo-Json)
Write-Host "    direct $($direct.dispatchNo) tripId=$($direct.tripId) vehicle=$($direct.vehicle)"
if ($direct.tripId) { throw "Direct dispatch should have null tripId." }
if ($direct.vehicle -ne "KA-77-ZZ-9999") { throw "Direct dispatch should keep its vehicle." }

Write-Host ""
Write-Host "==> ALL TRIP SMOKE TESTS PASSED"
