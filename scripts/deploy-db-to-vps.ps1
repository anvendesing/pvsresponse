<#
.SYNOPSIS
    Snapshot local SQLite DB, upload to VPS, and replace the production database once.

.DESCRIPTION
    Use when local dev has categories/concerns configured but VPS does not.
    Does NOT wipe uploads volume or run full deploy — only swaps dev.db.

.EXAMPLE
    .\scripts\deploy-db-to-vps.ps1 -VpsUser root

.EXAMPLE
    .\scripts\deploy-db-to-vps.ps1 -VpsUser root -SnapshotPath D:\backups\my-dev.db
#>

param(
    [string]$VpsHost = "217.216.78.119",
    [string]$VpsUser = "root",
    [string]$SshKey = "",
    [switch]$PasswordAuth,
    [string]$RepoPath = "",
    [string]$SnapshotPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. "$PSScriptRoot\lib\vps-connect.ps1"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $RepoRoot

$conn = Initialize-VpsConnection -VpsHost $VpsHost -VpsUser $VpsUser -SshKey $SshKey -PasswordAuth:$PasswordAuth
$RepoPath = Resolve-VpsRepoPath -SshOpts $conn.SshOpts -Target $conn.Target -RepoPath $RepoPath

if ($SnapshotPath) {
    $SnapshotLocal = (Resolve-Path $SnapshotPath).Path
    if (-not (Test-Path $SnapshotLocal)) { throw "Snapshot not found: $SnapshotPath" }
    Write-Host "=== Using existing snapshot ===" -ForegroundColor Cyan
} else {
    Write-Host "=== Step 1: Snapshot local database ===" -ForegroundColor Cyan
    $SnapshotLocal = Join-Path $RepoRoot "dev.db.snapshot"
    Push-Location (Join-Path $RepoRoot "backend")
    npx tsx scripts/snapshot-db.ts $SnapshotLocal
    if ($LASTEXITCODE -ne 0) {
        throw @"
DB snapshot failed. Ensure backend/.env DATABASE_URL points at your local dev.db
and the file exists (start backend once: cd backend && npm run dev).
"@
    }
    Pop-Location
}

$sizeMb = [math]::Round((Get-Item $SnapshotLocal).Length / 1MB, 2)
Write-Host "  $SnapshotLocal ($sizeMb MB)"

Write-Host ""
Write-Host "=== Step 2: Upload snapshot to VPS ===" -ForegroundColor Cyan
$RemoteDb = "/tmp/dev.db.snapshot"
Invoke-VpsScp -ScpOpts $conn.ScpOpts -Source $SnapshotLocal -TargetPath "$($conn.Target):$RemoteDb"

Write-Host ""
Write-Host "=== Step 3: Replace database on VPS (no full reset) ===" -ForegroundColor Cyan
$remoteCmd = "cd $RepoPath && bash scripts/replace-vps-db.sh $RemoteDb"
Write-Host "  Remote: $remoteCmd"
Invoke-VpsSsh -SshOpts $conn.SshOpts -Target $conn.Target -Command $remoteCmd

Write-Host ""
Write-Host "Done. Shop: http://${VpsHost}:8080/" -ForegroundColor Green
Write-Host "Previous VPS DB backed up on the novaerp_db volume as dev.db.backup-<timestamp>." -ForegroundColor DarkGray

Pop-Location
