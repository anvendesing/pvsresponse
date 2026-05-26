# Smoke test: bin CRUD - single, bulk-rack, edit, safe-delete.
$ErrorActionPreference = "Stop"
$base = "http://localhost:4000/v1"

Write-Host "==> Login"
$auth = Invoke-RestMethod -Method POST -Uri "$base/auth/login" -ContentType "application/json" `
  -Body (@{ username = "admin"; password = "nova1234" } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($auth.token)" }

Write-Host "==> Pick a warehouse"
$whs = Invoke-RestMethod -Method GET -Uri "$base/warehouses" -Headers $h
$wh = $whs | Where-Object { $_.active } | Select-Object -First 1
if (-not $wh) { throw "No active warehouse." }
Write-Host "    using $($wh.code) [$($wh.id)] (existing bins: $($wh.binCount))"

# Use an unusual zone label that's unlikely to collide with seed data
$zone = "SMK"
$rack = "R" + (Get-Random -Minimum 100 -Maximum 999)

Write-Host "==> POST /warehouses/:id/bins/bulk - $zone/$rack with 3 shelves x 2 bins"
$bulk = Invoke-RestMethod -Method POST -Uri "$base/warehouses/$($wh.id)/bins/bulk" -Headers $h `
  -ContentType "application/json" -Body (@{
    zone = $zone
    rack = $rack
    shelfCount = 3
    binsPerShelf = 2
    capacity = 75
  } | ConvertTo-Json)
Write-Host "    created=$($bulk.created) shelves=$($bulk.shelves) binsPerShelf=$($bulk.binsPerShelf)"
if ($bulk.created -ne 6) { throw "Expected 6 bins, got $($bulk.created)" }

Write-Host "==> Bulk-create same rack again (should 409)"
try {
  Invoke-RestMethod -Method POST -Uri "$base/warehouses/$($wh.id)/bins/bulk" -Headers $h `
    -ContentType "application/json" -Body (@{
      zone = $zone; rack = $rack; shelfCount = 1; binsPerShelf = 1; capacity = 50
    } | ConvertTo-Json) | Out-Null
  throw "Expected 409 on duplicate rack"
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 409) {
    throw "Expected 409, got $($_.Exception.Response.StatusCode.value__)"
  }
  Write-Host "    OK - 409 as expected"
}

Write-Host "==> POST /warehouses/:id/bins - single extra bin on shelf S1"
$single = Invoke-RestMethod -Method POST -Uri "$base/warehouses/$($wh.id)/bins" -Headers $h `
  -ContentType "application/json" -Body (@{
    zone = $zone; rack = $rack; shelf = "S1"; bin = "99"; capacity = 50
  } | ConvertTo-Json)
Write-Host "    created bin $($single.zone)/$($single.rack)/$($single.shelf)/$($single.bin) cap=$($single.capacity)"

Write-Host "==> PATCH /bins/:id - rename + recapacity"
$patched = Invoke-RestMethod -Method PATCH -Uri "$base/bins/$($single.id)" -Headers $h `
  -ContentType "application/json" -Body (@{ bin = "98"; capacity = 200 } | ConvertTo-Json)
if ($patched.bin -ne "98" -or $patched.capacity -ne 200) {
  throw "Patch didn't apply: bin=$($patched.bin) cap=$($patched.capacity)"
}
Write-Host "    updated to $($patched.bin) cap=$($patched.capacity)"

Write-Host "==> DELETE /bins/:id - empty bin"
$del = Invoke-RestMethod -Method DELETE -Uri "$base/bins/$($single.id)" -Headers $h
if (-not $del.deleted) { throw "Delete didn't succeed: $($del | ConvertTo-Json)" }
Write-Host "    deleted bin id=$($single.id)"

Write-Host "==> Verify final layout"
$final = Invoke-RestMethod -Method GET -Uri "$base/warehouses/$($wh.id)/bins" -Headers $h
$smkBins = $final | Where-Object { $_.zone -eq $zone -and $_.rack -eq $rack }
Write-Host "    $($smkBins.Count) bins remain in $zone/$rack (expected 6)"
if ($smkBins.Count -ne 6) { throw "Expected 6 bins to remain" }

Write-Host ""
Write-Host "==> ALL BIN SMOKE TESTS PASSED"
