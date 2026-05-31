<#
.SYNOPSIS
    Push latest code (optional) and run full VPS deploy over SSH.

.DESCRIPTION
    1. Optionally commits nothing — you must push main yourself, or use -SkipGitPush.
    2. SSHs to the VPS and runs scripts/vps-deploy.sh (--build or --pull).
    3. Includes: docker compose up, prisma migrate (entrypoint), db:sync-stock.

.PARAMETER VpsHost
    Default 217.216.78.119

.PARAMETER VpsUser
    Default root

.PARAMETER SshKey
    Path to SSH private key (e.g. C:\Users\You\.ssh\pvs_vps_key)

.PARAMETER RepoPath
    Remote repo directory. Auto-detected if empty.

.PARAMETER UseGhcr
    Use GHCR prebuilt images (sets REGISTRY_OWNER, --pull on remote).

.PARAMETER RegistryOwner
    GitHub user/org lowercase for ghcr.io images.

.PARAMETER ImageTag
    Default latest

.PARAMETER SkipGitPush
    Do not run git push before deploy.

.EXAMPLE
    .\scripts\deploy-to-vps.ps1 -SshKey "$env:USERPROFILE\.ssh\id_rsa"

.EXAMPLE
    .\scripts\deploy-to-vps.ps1 -UseGhcr -RegistryOwner anvendesing -ImageTag latest
#>

param(
    [string]$VpsHost = "217.216.78.119",
    [string]$VpsUser = "root",
    [string]$SshKey = "",
    [string]$RepoPath = "",
    [switch]$UseGhcr,
    [string]$RegistryOwner = "anvendesing",
    [string]$ImageTag = "latest",
    [switch]$SkipGitPush,
    [switch]$SkipSyncStock
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $RepoRoot

$sshOpts = @("-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=15")
$scpOpts = @("-o", "StrictHostKeyChecking=accept-new")
if ($SshKey) {
    if (-not (Test-Path $SshKey)) { throw "SSH key not found: $SshKey" }
    $sshOpts += @("-i", $SshKey)
    $scpOpts += @("-i", $SshKey)
}

function Invoke-Ssh([string]$Command) {
    & ssh @sshOpts "${VpsUser}@${VpsHost}" $Command
    if ($LASTEXITCODE -ne 0) { throw "SSH failed (exit $LASTEXITCODE)" }
}

if (-not $SkipGitPush) {
    $ahead = git rev-list --count origin/main..HEAD 2>$null
    $dirty = git status --porcelain
    if ($dirty) {
        Write-Host "WARNING: You have uncommitted local changes. Commit and push before deploy, or use -SkipGitPush." -ForegroundColor Yellow
        Write-Host $dirty
    }
    if ($ahead -and [int]$ahead -gt 0) {
        Write-Host "Pushing $ahead commit(s) to origin/main..."
        git push origin main
        if ($LASTEXITCODE -ne 0) { throw "git push failed" }
    } else {
        Write-Host "No unpushed commits on main (or branch not tracking origin/main)."
    }
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
Write-Host "Deploying to ${VpsUser}@${VpsHost}:${RepoPath}" -ForegroundColor Cyan

$remoteFlags = @()
if ($UseGhcr) { $remoteFlags += "--pull" } else { $remoteFlags += "--build" }
if ($SkipSyncStock) { $remoteFlags += "--no-sync" }

$envExports = ""
if ($UseGhcr) {
    $envExports = "export REGISTRY_OWNER='$RegistryOwner' IMAGE_TAG='$ImageTag'; "
}

$remoteCmd = "${envExports}cd $RepoPath && bash scripts/vps-deploy.sh $($remoteFlags -join ' ')"
Write-Host "Remote: $remoteCmd"
Invoke-Ssh $remoteCmd

Write-Host ""
Write-Host "Done. ERP: http://${VpsHost}/  Shop: http://${VpsHost}:8080/" -ForegroundColor Green

Pop-Location
