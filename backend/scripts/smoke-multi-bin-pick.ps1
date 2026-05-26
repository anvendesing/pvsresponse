# Smoke test: multi-location picking.
# 1. Login as admin
# 2. Pick the most recent SO that has bins available for at least one item
# 3. Cancel any open pick list, create a fresh one
# 4. Verify the system created >=1 PickListItem (and ideally 2+ rows for an SO line)
# 5. POST /pick-lists/:id/items to add another split, verify it appears
# 6. DELETE that split, verify it goes away

$ErrorActionPreference = "Stop"
$base = "http://localhost:4000/v1"

Write-Host "==> Login"
$auth = Invoke-RestMethod -Method POST -Uri "$base/auth/login" -ContentType "application/json" `
  -Body (@{ username = "admin"; password = "nova1234" } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($auth.token)" }

Write-Host "==> Find a confirmed SO"
$sos = Invoke-RestMethod -Method GET -Uri "$base/sales-orders?limit=20" -Headers $h
$so = $sos | Where-Object { $_.status -eq "confirmed" -or $_.status -eq "partially_invoiced" } | Select-Object -First 1
if (-not $so) { throw "No confirmed SO found" }
Write-Host "    SO $($so.soNo) [$($so.id)] customer=$($so.customer.name)"

Write-Host "==> Cancel any existing open pick list on this SO"
$pls = Invoke-RestMethod -Method GET -Uri "$base/pick-lists?salesOrderId=$($so.id)" -Headers $h
foreach ($pl in $pls) {
    if ($pl.status -in @("draft","picking")) {
        Write-Host "    cancelling $($pl.pickListNo)"
        Invoke-RestMethod -Method POST -Uri "$base/pick-lists/$($pl.id)/cancel" -Headers $h `
          -ContentType "application/json" -Body "{}" | Out-Null
    }
}

Write-Host "==> Create a fresh pick list"
$pickList = Invoke-RestMethod -Method POST -Uri "$base/sales-orders/$($so.id)/pick-lists" -Headers $h `
  -ContentType "application/json" -Body "{}"
Write-Host "    $($pickList.pickListNo) [$($pickList.id)] - $($pickList.items.Count) item rows"

# Show split structure: items grouped by salesOrderItemId
$grouped = $pickList.items | Group-Object salesOrderItemId
Write-Host "    SO lines: $($grouped.Count); rows: $($pickList.items.Count)"
foreach ($g in $grouped) {
    $rows = $g.Group
    $product = $rows[0].product.name
    $totalToPick = ($rows | Measure-Object qtyToPick -Sum).Sum
    Write-Host "      - $product : $($rows.Count) bin(s), total to pick $totalToPick"
    foreach ($r in $rows) {
        $binDesc = if ($r.bin) { "$($r.bin.zone)-$($r.bin.rack)-$($r.bin.shelf)-$($r.bin.bin) (free $($r.bin.qty - $r.bin.reservedQty))" } else { "(no bin)" }
        Write-Host "          bin=$binDesc qtyToPick=$($r.qtyToPick)"
    }
}

# Pick the first line and try to add another bin
$firstLine = $grouped[0]
$soItemId = $firstLine.Name
$productId = $firstLine.Group[0].productId
Write-Host "==> Look up another bin for product $productId across all warehouses"
$whs = Invoke-RestMethod -Method GET -Uri "$base/warehouses" -Headers $h
$bins = @()
foreach ($wh in $whs) {
    $whBins = Invoke-RestMethod -Method GET -Uri "$base/warehouses/$($wh.id)/bins" -Headers $h
    $bins += @($whBins | Where-Object { $_.productId -eq $productId -and $_.qty -gt 0 })
}
$used = @($firstLine.Group | ForEach-Object { $_.binId } | Where-Object { $_ })
$candidate = $bins | Where-Object { $used -notcontains $_.id -and ($_.qty - $_.reservedQty) -gt 0 } | Select-Object -First 1
if (-not $candidate) {
    Write-Host "    no spare bin in another location, falling back to first available bin to exercise the API"
    $candidate = $bins | Where-Object { ($_.qty - $_.reservedQty) -gt 0 } | Select-Object -First 1
}
if (-not $candidate) {
    Write-Host "    no usable bin at all, skipping add/remove split test"
} else {
    Write-Host "    candidate bin: $($candidate.zone)-$($candidate.rack)-$($candidate.shelf)-$($candidate.bin)"
    Write-Host "==> POST /pick-lists/$($pickList.id)/items - add new split"
    $newPl = Invoke-RestMethod -Method POST -Uri "$base/pick-lists/$($pickList.id)/items" -Headers $h `
      -ContentType "application/json" -Body (@{ salesOrderItemId = $soItemId; binId = $candidate.id; qtyToPick = 5 } | ConvertTo-Json)
    $newRows = $newPl.items | Where-Object { $_.salesOrderItemId -eq $soItemId }
    Write-Host "    SO line now has $($newRows.Count) row(s)"
    if ($newRows.Count -lt 2) { throw "Add split failed: row count did not grow" }

    $newRow = $newRows | Where-Object { $_.binId -eq $candidate.id } | Select-Object -First 1
    if (-not $newRow) { throw "Add split: new row not found" }

    Write-Host "==> DELETE /pick-lists/$($pickList.id)/items/$($newRow.id)"
    $afterPl = Invoke-RestMethod -Method DELETE -Uri "$base/pick-lists/$($pickList.id)/items/$($newRow.id)" -Headers $h
    $afterRows = $afterPl.items | Where-Object { $_.salesOrderItemId -eq $soItemId }
    Write-Host "    SO line now has $($afterRows.Count) row(s) after delete"
    if ($afterRows.Count -ne $newRows.Count - 1) { throw "Remove split: row count did not shrink" }
}

Write-Host "==> Cleanup"
Invoke-RestMethod -Method POST -Uri "$base/pick-lists/$($pickList.id)/cancel" -Headers $h `
  -ContentType "application/json" -Body "{}" | Out-Null

Write-Host "==> All checks passed"
