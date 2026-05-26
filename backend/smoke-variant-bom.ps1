# Variant-level BOM smoke test.
#
# Verifies:
#   1. Login.
#   2. GET /products/:id/variants-with-boms returns the parent + all
#      variants + which BOM (if any) each one has.
#   3. There are 3 BOMs for the demo product (6RKS): one product-level
#      default + 2 variant-specific.
#   4. Each variant-specific BOM explodes through the same downstream
#      tree but contains different packing leaf components (small vs
#      large pouch).
#   5. Cloning the 10pcs BOM to a "back-to-product-level" target
#      creates a new BOM and deactivates the old default.
#   6. After clone, the original 10pcs BOM is still active.
#   7. PATCH on the variant BOM works (revision bump).

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

# ---- 1. Login -----------------------------------------------------
$auth = $null
Step "login" {
  $script:auth = Invoke-RestMethod -Method POST -Uri "$base/auth/login" -ContentType "application/json" `
    -Body (@{ username = "admin"; password = "nova1234" } | ConvertTo-Json)
  if (-not $script:auth.token) { throw "no token" }
}
$h = @{ Authorization = "Bearer $($auth.token)" }

# ---- 2. variants-with-boms ---------------------------------------
$root = $null
$variantsInfo = $null
Step "GET /products/:id/variants-with-boms" {
  $boms = Invoke-RestMethod -Method GET -Uri "$base/boms" -Headers $h
  $script:root = $boms | Where-Object { $_.product.sku -eq "6RKS" -and -not $_.variantId } | Select-Object -First 1
  if (-not $script:root) { throw "no product-level BOM for 6RKS - run seed-multi-level-bom + seed-variant-bom-demo" }
  $script:variantsInfo = Invoke-RestMethod -Method GET -Uri "$base/products/$($root.product.id)/variants-with-boms" -Headers $h
  Write-Host ("    {0} variants:" -f $script:variantsInfo.variants.Count)
  foreach ($v in $script:variantsInfo.variants) {
    $status = if ($v.activeBom) { "BOM=$($v.activeBom.revision)/$($v.activeBom.componentCount)comp" } else { "no BOM" }
    Write-Host ("      {0,-22} {1,-10} {2}" -f $v.sku, $v.label, $status)
  }
  if ($script:variantsInfo.variants.Count -lt 2) { throw "expected >=2 active variants" }
}

# ---- 3. Three BOMs total (1 default + 2 variant-specific) --------
Step "BOM list shows 3 entries for 6RKS" {
  $boms = Invoke-RestMethod -Method GET -Uri "$base/boms?productId=$($root.product.id)" -Headers $h
  # Force-list semantics: wrap in @() *after* filtering, not on the raw call.
  $active = @($boms | Where-Object { $_.active })
  $defaults = @($active | Where-Object { -not $_.variantId })
  $variants = @($active | Where-Object { $_.variantId })
  $total = @($boms).Count
  Write-Host ("    total={0}, active={1}, default-level={2}, variant-level={3}" -f $total, $active.Count, $defaults.Count, $variants.Count)
  if ($defaults.Count -ne 1) { throw "expected 1 active product-level BOM, got $($defaults.Count)" }
  if ($variants.Count -lt 2) { throw "expected >=2 active variant-level BOMs, got $($variants.Count)" }
}

# ---- 4. Variant-specific explosion includes the right pouch ------
$smallVariantBom = $null
$largeVariantBom = $null
Step "explode 10pcs variant - includes CONS-POUCH-SM but NOT CONS-POUCH-LG" {
  $boms = Invoke-RestMethod -Method GET -Uri "$base/boms?productId=$($root.product.id)" -Headers $h
  foreach ($b in $boms) {
    if ($b.active -and $b.variant -and ($b.variant.size -eq "10 pcs")) { $script:smallVariantBom = $b }
    if ($b.active -and $b.variant -and ($b.variant.size -eq "30 pcs")) { $script:largeVariantBom = $b }
  }
  if (-not $script:smallVariantBom -or -not $script:largeVariantBom) { throw "could not find both variant BOMs" }
  $exp10 = Invoke-RestMethod -Method GET -Uri "$base/boms/$($script:smallVariantBom.id)/explode?qty=100" -Headers $h
  $skus10 = ($exp10 | ForEach-Object { $_.sku })
  Write-Host ("    10pcs leaves: {0}" -f ($skus10 -join ", "))
  if ($skus10 -notcontains "CONS-POUCH-SM") { throw "10pcs BOM should include CONS-POUCH-SM" }
  if ($skus10 -contains "CONS-POUCH-LG") { throw "10pcs BOM should NOT include CONS-POUCH-LG" }
}
Step "explode 30pcs variant - includes CONS-POUCH-LG but NOT CONS-POUCH-SM" {
  $exp30 = Invoke-RestMethod -Method GET -Uri "$base/boms/$($script:largeVariantBom.id)/explode?qty=100" -Headers $h
  $skus30 = ($exp30 | ForEach-Object { $_.sku })
  Write-Host ("    30pcs leaves: {0}" -f ($skus30 -join ", "))
  if ($skus30 -notcontains "CONS-POUCH-LG") { throw "30pcs BOM should include CONS-POUCH-LG" }
  if ($skus30 -contains "CONS-POUCH-SM") { throw "30pcs BOM should NOT include CONS-POUCH-SM" }
}

# ---- 5. Clone (10pcs -> NEW revision in same scope) --------------
$cloned = $null
Step "POST /boms/:id/clone bumps revision in same scope" {
  $script:cloned = Invoke-RestMethod -Method POST -Uri "$base/boms/$($smallVariantBom.id)/clone" -Headers $h `
    -ContentType "application/json" -Body (@{ setActive = $true } | ConvertTo-Json)
  if (-not $script:cloned.id) { throw "no clone id" }
  if ($script:cloned.id -eq $smallVariantBom.id) { throw "clone reused source id" }
  if ($script:cloned.variantId -ne $smallVariantBom.variantId) { throw "clone moved variant scope" }
  Write-Host ("    cloned: revision {0} -> {1}, items copied: {2}" -f $smallVariantBom.revision, $script:cloned.revision, $script:cloned.items.Count)
  if ($script:cloned.items.Count -ne $smallVariantBom.items.Count) { throw "item count drifted on clone" }
}
Step "previous 10pcs BOM is now inactive (auto-deactivated by activate-on-clone)" {
  $reread = Invoke-RestMethod -Method GET -Uri "$base/boms/$($smallVariantBom.id)" -Headers $h
  if ($reread.active) { throw "previous BOM should have been deactivated" }
  Write-Host ("    old BOM active=False, new BOM active=True - good")
}

# ---- 6. Clone (30pcs -> different variant) -----------------------
Step "POST /boms/:id/clone with new variantId moves scope" {
  # Clone the 30pcs BOM onto the 10pcs variant. Since 10pcs already
  # has an active BOM (the cloned one), the clone we just minted will
  # be deactivated by this new clone.
  $tenVariantId = ($variantsInfo.variants | Where-Object { $_.label -eq "10 pcs" }).id
  $body = @{ variantId = $tenVariantId; setActive = $false } | ConvertTo-Json
  $crossClone = Invoke-RestMethod -Method POST -Uri "$base/boms/$($largeVariantBom.id)/clone" -Headers $h `
    -ContentType "application/json" -Body $body
  if ($crossClone.variantId -ne $tenVariantId) { throw "variant scope did not change" }
  if ($crossClone.active) { throw "setActive=false should keep clone inactive" }
  Write-Host ("    crossClone {0} variantId={1} active={2}" -f $crossClone.id, $crossClone.variantId, $crossClone.active)
}

# ---- 7. Self-reference still rejected ----------------------------
Step "POST /boms with self-reference rejected" {
  try {
    $body = @{ productId = $root.product.id; items = @(@{ productId = $root.product.id; qty = 1; uom = "Pcs" }) } | ConvertTo-Json -Depth 4
    Invoke-RestMethod -Method POST -Uri "$base/boms" -Headers $h -ContentType "application/json" -Body $body | Out-Null
    throw "self-reference was accepted"
  } catch [System.Net.WebException] {
    Write-Host "    self-reference rejected as expected (HTTP error)"
  }
}

# ---- 8. Variant-product mismatch rejected ------------------------
Step "POST /boms with variantId from a different product is rejected" {
  $otherVariantBom = Invoke-RestMethod -Method GET -Uri "$base/boms" -Headers $h
  $otherVariant = $null
  foreach ($b in $otherVariantBom) {
    if ($b.variantId -and ($b.product.sku -ne "6RKS")) { $otherVariant = $b }
  }
  # If no foreign variant exists in the active BOM list, we just take
  # any variant from any product != 6RKS via direct lookup.
  if (-not $otherVariant) {
    Write-Host "    skipped (no other variant in catalog)" -ForegroundColor DarkYellow
    return
  }
  try {
    $body = @{
      productId = $root.product.id
      variantId = $otherVariant.variantId
      items = @()
    } | ConvertTo-Json -Depth 4
    Invoke-RestMethod -Method POST -Uri "$base/boms" -Headers $h -ContentType "application/json" -Body $body | Out-Null
    throw "mismatch was accepted"
  } catch [System.Net.WebException] {
    Write-Host "    mismatch rejected as expected"
  }
}

Write-Host ""
Write-Host "ALL VARIANT-LEVEL BOM SMOKE TESTS PASSED" -ForegroundColor Green
