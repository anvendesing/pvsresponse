<#
.SYNOPSIS
    Upload the search-alias SQL patch and apply it to the VPS Postgres database.
.EXAMPLE
    .\scripts\apply-alias-patch-to-vps.ps1 -VpsUser root
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
$SqlFile  = Join-Path $RepoRoot "scripts\patch-search-aliases.sql"

if (-not (Test-Path $SqlFile)) {
    throw "SQL patch not found at $SqlFile"
}

$conn = Initialize-VpsConnection -VpsHost $VpsHost -VpsUser $VpsUser -SshKey $SshKey -PasswordAuth:$PasswordAuth

Push-Location $RepoRoot

# 1. Upload SQL file to VPS /tmp
Write-Host "=== Uploading patch to VPS ===" -ForegroundColor Cyan
Invoke-VpsScp -ScpOpts $conn.ScpOpts -Source $SqlFile -TargetPath "$($conn.Target):/tmp/patch-search-aliases.sql"
Write-Host "  Uploaded OK" -ForegroundColor Green

# 2. Detect postgres container name
Write-Host ""
Write-Host "=== Detecting Postgres container ===" -ForegroundColor Cyan
$pgContainer = (& ssh @($conn.SshOpts) $conn.Target "docker ps --filter name=postgres --format '{{.Names}}' | head -1").Trim()
if (-not $pgContainer) { $pgContainer = "novaerp-postgres-1" }
Write-Host "  Container: $pgContainer"

# 3. Copy SQL into container and apply it
Write-Host ""
Write-Host "=== Applying alias patch ===" -ForegroundColor Cyan
$copyCmd  = "docker cp /tmp/patch-search-aliases.sql ${pgContainer}:/tmp/patch-search-aliases.sql"
$applyCmd = "docker exec -i $pgContainer psql -U novaerp -d novaerp -f /tmp/patch-search-aliases.sql"
Invoke-VpsSsh -SshOpts $conn.SshOpts -Target $conn.Target -Command $copyCmd
Invoke-VpsSsh -SshOpts $conn.SshOpts -Target $conn.Target -Command $applyCmd

Write-Host ""
Write-Host "Done. Search aliases are now live on the VPS." -ForegroundColor Green

Pop-Location
