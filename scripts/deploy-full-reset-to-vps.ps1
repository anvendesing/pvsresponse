<#
.SYNOPSIS
    Push code, upload local DB snapshot, and full-reset deploy on the VPS.

.DESCRIPTION
    ORDER OF OPERATIONS:
      1. Commit all changes on Windows (git add / git commit)
      2. Run THIS script — it pushes to GitHub, uploads dev.db.snapshot, rebuilds VPS

    AUTH — no SSH key: omit -SshKey; enter VPS password when prompted.

.EXAMPLE
    .\scripts\deploy-full-reset-to-vps.ps1 -VpsUser root

.EXAMPLE
    .\scripts\deploy-full-reset-to-vps.ps1 -VpsUser root -SkipGitPush
#>

param(
    [string]$VpsHost = "217.216.78.119",
    [string]$VpsUser = "root",
    [string]$SshKey = "",
    [switch]$PasswordAuth,
    [string]$RepoPath = "",
    [switch]$SkipGitPush,
    [switch]$UseGhcr,
    [string]$RegistryOwner = "anvendesing",
    [string]$ImageTag = "latest"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. "$PSScriptRoot\lib\vps-connect.ps1"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $RepoRoot

$conn = Initialize-VpsConnection -VpsHost $VpsHost -VpsUser $VpsUser -SshKey $SshKey -PasswordAuth:$PasswordAuth

Write-Host "=== Step 1: Sync warehouse layout (prune + seed) ===" -ForegroundColor Cyan
Push-Location (Join-Path $RepoRoot "backend")
npm run db:sync-warehouse-layout:dev
if ($LASTEXITCODE -ne 0) { throw "Warehouse layout sync failed" }
Pop-Location

Write-Host ""
Write-Host "=== Step 2: Snapshot local database ===" -ForegroundColor Cyan
$SnapshotLocal = Join-Path $RepoRoot "dev.db.snapshot"
Push-Location (Join-Path $RepoRoot "backend")
npx tsx scripts/snapshot-db.ts $SnapshotLocal
if ($LASTEXITCODE -ne 0) { throw "DB snapshot failed" }
Pop-Location
$sizeMb = [math]::Round((Get-Item $SnapshotLocal).Length / 1MB, 2)
Write-Host "  $SnapshotLocal ($sizeMb MB)"

if (-not $SkipGitPush) {
    Write-Host ""
    Write-Host "=== Step 3: Push to origin/main ===" -ForegroundColor Cyan
    $dirty = git status --porcelain
    if ($dirty) {
        throw "Uncommitted changes remain. Commit first, then re-run."
    }
    $ahead = git rev-list --count origin/main..HEAD 2>$null
    if ($ahead -and [int]$ahead -gt 0) {
        git push origin main
        if ($LASTEXITCODE -ne 0) { throw "git push failed" }
    } else {
        Write-Host "  Already up to date with origin/main."
    }
} else {
    Write-Host ""
    Write-Host "=== Step 3: Skipped git push (-SkipGitPush) ===" -ForegroundColor Yellow
}

$RepoPath = Resolve-VpsRepoPath -SshOpts $conn.SshOpts -Target $conn.Target -RepoPath $RepoPath

Write-Host ""
Write-Host "=== Step 4: Upload DB snapshot to VPS ===" -ForegroundColor Cyan
$RemoteDb = "/tmp/dev.db.snapshot"
Invoke-VpsScp -ScpOpts $conn.ScpOpts -Source $SnapshotLocal -TargetPath "$($conn.Target):$RemoteDb"

Write-Host ""
Write-Host "=== Step 5: Full reset deploy on VPS ===" -ForegroundColor Cyan
$remoteFlags = @("--reset-data", "--replace-db", $RemoteDb)
if ($UseGhcr) { $remoteFlags = @("--pull") + $remoteFlags } else { $remoteFlags = @("--build") + $remoteFlags }

$envExports = ""
if ($UseGhcr) {
    $envExports = "export REGISTRY_OWNER='$RegistryOwner' IMAGE_TAG='$ImageTag'; "
}

$remoteCmd = "${envExports}cd $RepoPath && bash scripts/vps-deploy.sh $($remoteFlags -join ' ')"
Write-Host "  Remote: $remoteCmd"
Invoke-VpsSsh -SshOpts $conn.SshOpts -Target $conn.Target -Command $remoteCmd

Write-Host ""
Write-Host "=== Step 6: Upload product images (optional) ===" -ForegroundColor Cyan
$imgScript = Join-Path $RepoRoot "scripts\upload-images-to-vps.ps1"
if (Test-Path $imgScript) {
    $imgArgs = @{ VpsHost = $VpsHost; VpsUser = $VpsUser; PasswordAuth = $PasswordAuth }
    if ($SshKey) { $imgArgs.SshKey = $SshKey }
    try {
        & $imgScript @imgArgs
    } catch {
        Write-Host "  Image upload skipped or failed: $_" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Done. ERP: http://${VpsHost}/  Shop: http://${VpsHost}:8080/" -ForegroundColor Green
Write-Host "WARNING: --reset-data wiped the previous VPS database and uploads volume." -ForegroundColor Yellow

Pop-Location
