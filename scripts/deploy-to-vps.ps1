<#
.SYNOPSIS
    Push latest code (optional) and run full VPS deploy over SSH.

.DESCRIPTION
    ORDER OF OPERATIONS (important):
      1. On Windows: commit your changes  (git add / git commit)
      2. On Windows: run THIS script       (pushes to GitHub, then VPS git pull + rebuild)
         — OR push manually (git push), then on the VPS run: bash scripts/vps-update.sh

    The VPS never commits code — it only pulls from GitHub.

    AUTH — no SSH key required:
      Omit -SshKey. OpenSSH will prompt for your VPS username/password.
      Use -VpsUser if your login is not root (e.g. ubuntu, admin).

.EXAMPLE
    # Password login (prompted when script runs):
    .\scripts\deploy-to-vps.ps1 -VpsUser root

.EXAMPLE
    # SSH key (optional):
    .\scripts\deploy-to-vps.ps1 -VpsUser root -SshKey "$env:USERPROFILE\.ssh\id_rsa"

.EXAMPLE
    # Code already pushed; only update VPS:
    .\scripts\deploy-to-vps.ps1 -VpsUser root -SkipGitPush
#>

param(
    [string]$VpsHost = "217.216.78.119",
    [string]$VpsUser = "root",
    [string]$SshKey = "",
    [switch]$PasswordAuth,
    [string]$RepoPath = "",
    [switch]$UseGhcr,
    [string]$RegistryOwner = "anvendesing",
    [string]$ImageTag = "latest",
    [switch]$SkipGitPush,
    [switch]$SkipSyncStock
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. "$PSScriptRoot\lib\vps-connect.ps1"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $RepoRoot

$conn = Initialize-VpsConnection -VpsHost $VpsHost -VpsUser $VpsUser -SshKey $SshKey -PasswordAuth:$PasswordAuth

if (-not $SkipGitPush) {
    Write-Host "=== Step 1: Push commits to GitHub ===" -ForegroundColor Cyan
    $ahead = git rev-list --count origin/main..HEAD 2>$null
    $dirty = git status --porcelain
    if ($dirty) {
        throw @"
Uncommitted changes remain. Commit first:
  git add -A
  git commit -m "your message"
Then re-run this script.
"@
    }
    if ($ahead -and [int]$ahead -gt 0) {
        Write-Host "  Pushing $ahead commit(s) to origin/main..."
        git push origin main
        if ($LASTEXITCODE -ne 0) { throw "git push failed" }
    } else {
        Write-Host "  Already up to date with origin/main."
    }
} else {
    Write-Host "=== Step 1: Skipped git push (-SkipGitPush) ===" -ForegroundColor Yellow
}

$RepoPath = Resolve-VpsRepoPath -SshOpts $conn.SshOpts -Target $conn.Target -RepoPath $RepoPath

Write-Host ""
Write-Host "=== Step 2: Deploy on VPS ===" -ForegroundColor Cyan
Write-Host "  ${VpsUser}@${VpsHost}:${RepoPath}" -ForegroundColor DarkGray

$remoteFlags = @()
if ($UseGhcr) { $remoteFlags += "--pull" } else { $remoteFlags += "--build" }
if ($SkipSyncStock) { $remoteFlags += "--no-sync" }

$envExports = ""
if ($UseGhcr) {
    $envExports = "export REGISTRY_OWNER='$RegistryOwner' IMAGE_TAG='$ImageTag'; "
}

$remoteCmd = "${envExports}cd $RepoPath && bash scripts/vps-update.sh $($remoteFlags -join ' ')"
Write-Host "  Remote: $remoteCmd"
Invoke-VpsSsh -SshOpts $conn.SshOpts -Target $conn.Target -Command $remoteCmd

Write-Host ""
Write-Host "Done. ERP: http://${VpsHost}/  Shop: http://${VpsHost}:8080/" -ForegroundColor Green

Pop-Location
