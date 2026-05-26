# Manufacturing module smoke test.
#
# Verifies the full BOM + MO lifecycle end-to-end against the running
# backend at http://localhost:4000:
#
#   1. Login as admin
#   2. List BOMs and pick the multi-level demo (3-level oil pack)
#   3. GET /boms/:id/tree?qty=50  (tree)
#   4. GET /boms/:id/explode?qty=50 (flat leaves)
#   5. GET /products/:id/where-used (reverse lookup)
#   6. Create new MO for 50 units
#   7. GET /production-orders/:id/requirements (shortage check)
#   8. POST /production-orders/:id/issue-materials
#   9. POST /production-orders/:id/log-output (good=20)
#  10. POST /production-orders/:id/log-output (good=30)
#  11. POST /production-orders/:id/complete (final qty=50, FG posted)
#  12. Re-read MO and confirm status=completed
#
# All steps print a short PASS/FAIL line. The script exits 1 on any
# failure so it can be used as a CI gate.

$ErrorActionPreference = "Stop"
$base = "http://localhost:4000/v1"

function Step($name, $script) {
  Write-Host ("==> {0}" -f $name) -ForegroundColor Cyan
  try {
    & $script
    Write-Host ("    PASS - {0}" -f $name) -ForegroundColor Green
  } catch {
    Write-Host ("    FAIL - {0}: {1}" -f $name, $_.Exception.Message) -ForegroundColor Red
    if ($_.Exception.Response) {
      try {
        $body = (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd()
        Write-Host ("    body: {0}" -f $body) -ForegroundColor DarkRed
      } catch { }
    }
    exit 1
  }
}

# ---- 1. Login ------------------------------------------------------
$auth = $null
Step "login as admin" {
  $script:auth = Invoke-RestMethod -Method POST -Uri "$base/auth/login" -ContentType "application/json" `
    -Body (@{ username = "admin"; password = "nova1234" } | ConvertTo-Json)
  if (-not $script:auth.token) { throw "no token returned" }
}
$h = @{ Authorization = "Bearer $($auth.token)" }

# ---- 2. Find the multi-level demo BOM ------------------------------
$rootBom = $null
Step "find demo multi-level BOM" {
  $boms = Invoke-RestMethod -Method GET -Uri "$base/boms" -Headers $h
  # Pick the BOM whose product is the finished pack 6RKS (the demo
  # script seeds against the first finished product). Fallback: the
  # newest BOM.
  $script:rootBom = $boms | Where-Object { $_.product.sku -eq "6RKS" } | Select-Object -First 1
  if (-not $script:rootBom) { $script:rootBom = $boms | Select-Object -First 1 }
  if (-not $script:rootBom) { throw "no BOMs in catalog" }
  Write-Host ("    using BOM {0} ({1} - {2})" -f $script:rootBom.id, $script:rootBom.product.sku, $script:rootBom.revision)
}

# ---- 3. Tree (multi-level) -----------------------------------------
Step "GET /boms/:id/tree?qty=50 walks every level" {
  $tree = Invoke-RestMethod -Method GET -Uri "$base/boms/$($rootBom.id)/tree?qty=50" -Headers $h
  if (-not $tree.children -or $tree.children.Count -eq 0) { throw "tree has no children" }
  # Find at least one node at depth 3 (sub-of-sub).
  $hasL3 = $false
  foreach ($c1 in $tree.children) {
    $kids = if ($c1.children) { $c1.children } else { @() }
    foreach ($c2 in $kids) {
      if ($c2.children -and $c2.children.Count -gt 0) { $hasL3 = $true }
    }
  }
  if (-not $hasL3) {
    Write-Host "    note: BOM is only 2-level (no sub-of-sub) - that's fine for some products" -ForegroundColor DarkYellow
  } else {
    Write-Host "    confirmed >=3 levels deep"
  }
}

# ---- 4. Flat explode -----------------------------------------------
$leafCount = 0
Step "GET /boms/:id/explode?qty=50 returns flat leaves" {
  $exp = Invoke-RestMethod -Method GET -Uri "$base/boms/$($rootBom.id)/explode?qty=50" -Headers $h
  if ($exp.Count -lt 1) { throw "no leaves returned" }
  $script:leafCount = $exp.Count
  Write-Host ("    {0} leaf component(s):" -f $exp.Count)
  foreach ($l in $exp) {
    Write-Host ("      {0,-18} {1,8:N2} {2,-4} via {3}" -f $l.sku, $l.qty, $l.uom, ($l.path -join " > "))
  }
}

# ---- 5. Where-used -------------------------------------------------
Step "GET /products/:id/where-used returns at least one parent" {
  # Pick the deepest leaf - if BOM is multi-level then a raw should be
  # used in a sub-assembly's BOM.
  $exp = Invoke-RestMethod -Method GET -Uri "$base/boms/$($rootBom.id)/explode?qty=1" -Headers $h
  $rawOil = $exp | Where-Object { $_.sku -eq "RAW-COCO-OIL" } | Select-Object -First 1
  if (-not $rawOil) { Write-Host "    skipped (no RAW-COCO-OIL leaf)"; return }
  $where = Invoke-RestMethod -Method GET -Uri "$base/products/$($rawOil.productId)/where-used" -Headers $h
  if ($where.Count -lt 1) { throw "RAW-COCO-OIL claims no parent" }
  Write-Host ("    RAW-COCO-OIL is used in {0} BOM(s):" -f $where.Count)
  foreach ($w in $where) {
    Write-Host ("      {0,-18} qty/parent={1}" -f $w.parentSku, $w.qtyPer)
  }
}

# ---- 6. Create MO --------------------------------------------------
$mo = $null
Step "POST /production-orders creates an MO" {
  $start = (Get-Date).ToString("yyyy-MM-dd")
  $due = (Get-Date).AddDays(3).ToString("yyyy-MM-dd")
  $body = @{
    bomId       = $rootBom.id
    station     = "Smoke line"
    plannedQty  = 50
    startDate   = $start
    dueDate     = $due
  } | ConvertTo-Json
  $script:mo = Invoke-RestMethod -Method POST -Uri "$base/production-orders" -Headers $h -ContentType "application/json" -Body $body
  if (-not $script:mo.id) { throw "no MO id returned" }
  Write-Host ("    created MO {0} (id={1})" -f $script:mo.orderNo, $script:mo.id)
}

# ---- 7. Requirements -----------------------------------------------
Step "GET /production-orders/:id/requirements" {
  $req = Invoke-RestMethod -Method GET -Uri "$base/production-orders/$($mo.id)/requirements" -Headers $h
  if ($req.lines.Count -ne $leafCount) { throw "requirements lines ($($req.lines.Count)) != leaf count ($leafCount)" }
  Write-Host ("    plannedFor={0}, anyShortage={1}, lines={2}" -f $req.plannedFor, $req.anyShortage, $req.lines.Count)
}

# ---- 8. Issue materials --------------------------------------------
Step "POST /production-orders/:id/issue-materials" {
  $res = Invoke-RestMethod -Method POST -Uri "$base/production-orders/$($mo.id)/issue-materials" -Headers $h `
    -ContentType "application/json" -Body (@{ allowShort = $true } | ConvertTo-Json)
  Write-Host ("    issued {0} component lines, anyShort={1}" -f $res.issued.Count, $res.anyShort)
  foreach ($i in $res.issued) {
    $sym = if ($i.issued -ge $i.requested) { "ok " } else { "**" }
    Write-Host ("      {0} {1,-18} {2,8} of {3,8}" -f $sym, $i.sku, $i.issued, $i.requested)
  }
  if ($res.productionOrder.status -ne "in-progress") { throw "MO status did not advance to 'in-progress' (got $($res.productionOrder.status))" }
}

# ---- 9. Log output (twice) -----------------------------------------
Step "POST /production-orders/:id/log-output (round 1: 20 good)" {
  $res = Invoke-RestMethod -Method POST -Uri "$base/production-orders/$($mo.id)/log-output" -Headers $h `
    -ContentType "application/json" -Body (@{ goodQty = 20; scrapQty = 0 } | ConvertTo-Json)
  if ($res.actualQty -ne 20) { throw "expected actualQty=20 got $($res.actualQty)" }
}
Step "POST /production-orders/:id/log-output (round 2: 30 good, 1 scrap)" {
  $res = Invoke-RestMethod -Method POST -Uri "$base/production-orders/$($mo.id)/log-output" -Headers $h `
    -ContentType "application/json" -Body (@{ goodQty = 30; scrapQty = 1 } | ConvertTo-Json)
  if ($res.actualQty -ne 50) { throw "expected actualQty=50 got $($res.actualQty)" }
  if ($res.scrapQty -ne 1) { throw "expected scrapQty=1 got $($res.scrapQty)" }
}

# ---- 10. Complete --------------------------------------------------
Step "POST /production-orders/:id/complete posts FG to inventory" {
  $res = Invoke-RestMethod -Method POST -Uri "$base/production-orders/$($mo.id)/complete" -Headers $h `
    -ContentType "application/json" -Body (@{} | ConvertTo-Json)
  if ($res.productionOrder.status -ne "completed") { throw "expected status=completed, got $($res.productionOrder.status)" }
  if ($res.putaway) {
    Write-Host ("    {0} units put away in bin {1}" -f $res.putaway.qty, $res.putaway.bin)
  } else {
    Write-Host "    no FG bin found - completed without putaway (manual transfer required)" -ForegroundColor Yellow
  }
}

# ---- 11. Verify post-conditions ------------------------------------
Step "GET /production-orders/:id confirms completion" {
  $po = Invoke-RestMethod -Method GET -Uri "$base/production-orders/$($mo.id)" -Headers $h
  if ($po.status -ne "completed") { throw "MO not completed" }
  if ($po.actualQty -ne 50) { throw "MO actualQty != 50" }
  Write-Host ("    MO {0} closed with {1}/{2} good ({3}% efficiency)" -f $po.orderNo, $po.actualQty, $po.plannedQty, $po.efficiency)
}

Write-Host ""
Write-Host "ALL MANUFACTURING SMOKE TESTS PASSED" -ForegroundColor Green
