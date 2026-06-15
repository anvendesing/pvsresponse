<#
.SYNOPSIS
    Push code, upload local DB snapshot, and full-reset deploy on the VPS.

.DESCRIPTION
    1. Creates a consistent SQLite snapshot from backend/prisma/dev.db.
    2. Optionally git push origin main.
    3. SCPs the snapshot to the VPS.
    4. Runs vps-deploy.sh --reset-data --replace-db (wipes old DB/uploads, deploys code, loads snapshot).

.PARAMETER VpsHost
    Default 217.216.78.119

.PARAMETER VpsUser
    Default root

.PARAMETER SshKey
    SSH private key path. Leave empty for password auth (scp/ssh will prompt).

.PARAMETER SkipGitPush
    Skip git push (use when code is already on origin/main).

.EXAMPLE
    .\scripts\deploy-full-reset-to-vps.ps1

.EXAMPLE
    .\scripts\deploy-full-reset-to-vps.ps1 -SshKey "$env:USERPROFILE\.ssh\pvs_vps_key"
#>

param(
    [string]$VpsHost = "217.216.78.119",
    [string]$VpsUser = "root",
    [string]$SshKey = "",
    [string]$RepoPath = "",
    [switch]$SkipGitPush,
    [switch]$UseGhcr,
    [string]$RegistryOwner = "anvendesing",
    [string]$ImageTag = "latest"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $RepoRoot

$sshOpts = @("-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=20")
$scpOpts = @("-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=20")
if ($SshKey) {
    if (-not (Test-Path $SshKey)) { throw "SSH key not found: $SshKey" }
    $sshOpts += @("-i", $SshKey)
    $scpOpts += @("-i", $SshKey)
}

function Invoke-Ssh([string]$Command) {
    & ssh @sshOpts "${VpsUser}@${VpsHost}" $Command
    if ($LASTEXITCODE -ne 0) { throw "SSH failed (exit $LASTEXITCODE)" }
}

Write-Host "=== Step 1: Snapshot local database ===" -ForegroundColor Cyan
$SnapshotLocal = Join-Path $RepoRoot "dev.db.snapshot"
Push-Location (Join-Path $RepoRoot "backend")
npx tsx scripts/snapshot-db.ts $SnapshotLocal
if ($LASTEXITCODE -ne 0) { throw "DB snapshot failed" }
Pop-Location
$sizeMb = [math]::Round((Get-Item $SnapshotLocal).Length / 1MB, 2)
Write-Host "  $SnapshotLocal ($sizeMb MB)"

if (-not $SkipGitPush) {
    Write-Host ""
    Write-Host "=== Step 2: Push to origin/main ===" -ForegroundColor Cyan
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
    Write-Host "=== Step 2: Skipped git push (-SkipGitPush) ===" -ForegroundColor Yellow
}

if (-not $RepoPath) {
    foreach ($candidate in @("~/pvsresponse", "~/novaerp", "/root/pvsresponse", "/root/novaerp")) {
        $probe = "test -d $candidate/.git && echo $candidate"
        $found = & ssh @sshOpts "${VpsUser}@${VpsHost}" $probe 2>$null
        if ($LASTEXITCODE -eq 0 -and $found) {
            $RepoPath = $found.Trim()
            break
        }
    }
    if (-not $RepoPath) { $RepoPath = "~/pvsresponse" }
}

Write-Host ""
Write-Host "=== Step 3: Upload DB snapshot to VPS ===" -ForegroundColor Cyan
$RemoteDb = "/tmp/dev.db.snapshot"
& scp @scpOpts $SnapshotLocal "${VpsUser}@${VpsHost}:${RemoteDb}"
if ($LASTEXITCODE -ne 0) { throw "scp failed" }

Write-Host ""
Write-Host "=== Step 4: Full reset deploy on VPS ===" -ForegroundColor Cyan
$remoteFlags = @("--reset-data", "--replace-db", $RemoteDb)
if ($UseGhcr) { $remoteFlags = @("--pull") + $remoteFlags } else { $remoteFlags = @("--build") + $remoteFlags }

$envExports = ""
if ($UseGhcr) {
    $envExports = "export REGISTRY_OWNER='$RegistryOwner' IMAGE_TAG='$ImageTag'; "
}

$remoteCmd = "${envExports}cd $RepoPath && bash scripts/vps-deploy.sh $($remoteFlags -join ' ')"
Write-Host "  Remote: $remoteCmd"
Invoke-Ssh $remoteCmd

Write-Host ""
Write-Host "=== Step 5: Upload product images (optional) ===" -ForegroundColor Cyan
$imgScript = Join-Path $RepoRoot "scripts\upload-images-to-vps.ps1"
if (Test-Path $imgScript) {
    $imgArgs = @{ VpsHost = $VpsHost; VpsUser = $VpsUser }
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
