<#
.SYNOPSIS
    Apply zero-GST barcode patch to VPS Postgres (variants + parent products).
.EXAMPLE
    .\scripts\apply-zero-gst-patch-to-vps.ps1 -VpsUser root
#>
param(
    [string]$VpsHost = "217.216.78.119",
    [string]$VpsUser = "root",
    [string]$SshKey  = "",
    [switch]$PasswordAuth
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. "$PSScriptRoot\lib\vps-connect.ps1"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$SqlFile  = Join-Path $RepoRoot "scripts\patch-zero-gst-barcodes.sql"

if (-not (Test-Path $SqlFile)) {
    throw "SQL patch not found at $SqlFile"
}

$conn = Initialize-VpsConnection -VpsHost $VpsHost -VpsUser $VpsUser -SshKey $SshKey -PasswordAuth:$PasswordAuth

Push-Location $RepoRoot

Write-Host "=== Uploading zero-GST patch to VPS ===" -ForegroundColor Cyan
Invoke-VpsScp -ScpOpts $conn.ScpOpts -Source $SqlFile -TargetPath "$($conn.Target):/tmp/patch-zero-gst-barcodes.sql"

Write-Host ""
Write-Host "=== Detecting Postgres container ===" -ForegroundColor Cyan
$pgContainer = (& ssh @($conn.SshOpts) $conn.Target "docker ps --filter name=postgres --format '{{.Names}}' | head -1").Trim()
if (-not $pgContainer) { $pgContainer = "novaerp-postgres-1" }
Write-Host "  Container: $pgContainer"

Write-Host ""
Write-Host "=== Applying zero-GST patch ===" -ForegroundColor Cyan
$copyCmd  = "docker cp /tmp/patch-zero-gst-barcodes.sql ${pgContainer}:/tmp/patch-zero-gst-barcodes.sql"
$applyCmd = "docker exec -i $pgContainer psql -U novaerp -d novaerp -f /tmp/patch-zero-gst-barcodes.sql"
Invoke-VpsSsh -SshOpts $conn.SshOpts -Target $conn.Target -Command $copyCmd
Invoke-VpsSsh -SshOpts $conn.SshOpts -Target $conn.Target -Command $applyCmd

Write-Host ""
Write-Host "=== Busting Redis catalog cache on VPS ===" -ForegroundColor Cyan
$redisCmd = @"
redis=\$(docker ps --filter name=redis --format '{{.Names}}' | head -1)
if [ -n "\$redis" ]; then
  docker exec \$redis redis-cli KEYS 'catalog:*' | xargs -r docker exec \$redis redis-cli DEL
  echo "Cleared catalog:* keys"
else
  echo "Redis container not found — catalog TTL will expire in ~60s"
fi
"@
Invoke-VpsSsh -SshOpts $conn.SshOpts -Target $conn.Target -Command $redisCmd

Write-Host ""
Write-Host "Done. Zero-GST barcodes are live on VPS production." -ForegroundColor Green

Pop-Location
