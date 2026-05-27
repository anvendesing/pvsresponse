<#
.SYNOPSIS
    Uploads local product images to the VPS backend Docker volume.

.DESCRIPTION
    1. Compresses backend/uploads/products/ into a tar archive.
    2. SCPs the archive to the VPS.
    3. SSHs in and uses "docker cp" to place files inside the running
       backend container's /app/uploads/products/ directory.
    4. Cleans up the temp archive.

.PARAMETER VpsHost
    VPS IP or hostname. Defaults to 217.216.78.119.

.PARAMETER VpsUser
    SSH user on the VPS. Defaults to "root".

.PARAMETER SshKey
    Path to the SSH private key. Leave empty to rely on ssh-agent / default key.

.PARAMETER LocalDir
    Local folder containing the product images.
    Defaults to "<repo-root>\backend\uploads\products".

.EXAMPLE
    # Default VPS, default user, default key
    .\scripts\upload-images-to-vps.ps1

.EXAMPLE
    # Custom SSH key
    .\scripts\upload-images-to-vps.ps1 -SshKey "C:\Users\Sharath\.ssh\pvs_vps_key"
#>

param(
    [string]$VpsHost  = "217.216.78.119",
    [string]$VpsUser  = "root",
    [string]$SshKey   = "",           # leave blank to use default/agent key
    [string]$LocalDir = ""            # auto-detected from script location
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Resolve paths ─────────────────────────────────────────────────────────────
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $LocalDir) {
    $LocalDir = Join-Path $RepoRoot "backend\uploads\products"
}

if (-not (Test-Path $LocalDir)) {
    Write-Error "Local image folder not found: $LocalDir"
    exit 1
}

$imgCount = (Get-ChildItem $LocalDir -File).Count
if ($imgCount -eq 0) {
    Write-Warning "No files found in $LocalDir — nothing to upload."
    exit 0
}

Write-Host ""
Write-Host "=== PVS Product Image Upload ===" -ForegroundColor Cyan
Write-Host "  Local  : $LocalDir ($imgCount files)"
Write-Host "  Remote : ${VpsUser}@${VpsHost}:/app/uploads/products/ (via docker cp)"
Write-Host ""

# ── SSH options ───────────────────────────────────────────────────────────────
$sshOpts = @("-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10")
if ($SshKey) { $sshOpts += @("-i", $SshKey) }

$scpOpts = @("-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10")
if ($SshKey) { $scpOpts += @("-i", $SshKey) }

# ── 1. Detect the backend container name on the VPS ──────────────────────────
Write-Host "Step 1/4  Detecting backend container on VPS ..." -ForegroundColor Yellow
$containerName = ssh @sshOpts "${VpsUser}@${VpsHost}" `
    "docker ps --filter 'name=backend' --format '{{.Names}}' | head -1" 2>&1

if (-not $containerName -or $containerName -match "Error") {
    Write-Error "Could not detect backend container. Is the stack running on the VPS?`nOutput: $containerName"
    exit 1
}
Write-Host "  Container: $containerName" -ForegroundColor Green

# ── 2. Create a temp tar of the local images ──────────────────────────────────
Write-Host "Step 2/4  Creating local archive ..." -ForegroundColor Yellow
$tmpTar = Join-Path $env:TEMP "pvs_products_$(Get-Date -Format 'yyyyMMddHHmmss').tar.gz"

# Use tar (available in Windows 10+ build 17063 and Git-for-Windows)
& tar -czf $tmpTar -C $LocalDir .
if ($LASTEXITCODE -ne 0) {
    Write-Error "tar failed. Make sure tar is available (Windows 10+ or Git Bash)."
    exit 1
}
$tarSize = [math]::Round((Get-Item $tmpTar).Length / 1MB, 1)
Write-Host "  Archive : $tmpTar ($tarSize MB)" -ForegroundColor Green

# ── 3. SCP archive to VPS ─────────────────────────────────────────────────────
Write-Host "Step 3/4  Uploading archive to VPS /tmp/ ..." -ForegroundColor Yellow
$remoteTar = "/tmp/pvs_products.tar.gz"
& scp @scpOpts $tmpTar "${VpsUser}@${VpsHost}:${remoteTar}"
if ($LASTEXITCODE -ne 0) {
    Remove-Item $tmpTar -Force
    Write-Error "SCP failed. Check your SSH credentials and VPS connectivity."
    exit 1
}
Write-Host "  Uploaded to ${VpsHost}:${remoteTar}" -ForegroundColor Green

# ── 4. SSH: extract into container via docker cp ──────────────────────────────
Write-Host "Step 4/4  Copying images into container $containerName ..." -ForegroundColor Yellow

$remoteCmd = @"
set -e
# Extract to a host-side temp dir first
TMPDIR=\$(mktemp -d)
tar -xzf $remoteTar -C \$TMPDIR
# Ensure target directory exists in the container
docker exec $containerName mkdir -p /app/uploads/products
# Copy every file from the temp dir into the container
for f in \$TMPDIR/*; do
  docker cp "\$f" "$containerName:/app/uploads/products/"
done
rm -rf \$TMPDIR $remoteTar
echo "DONE"
"@

$result = ssh @sshOpts "${VpsUser}@${VpsHost}" $remoteCmd 2>&1
Write-Host $result

if ($result -match "DONE") {
    Write-Host ""
    Write-Host "All $imgCount images copied to $containerName:/app/uploads/products/" -ForegroundColor Green
} else {
    Write-Warning "Something may have gone wrong. Check output above."
}

# ── Cleanup local temp ────────────────────────────────────────────────────────
Remove-Item $tmpTar -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Verify with:" -ForegroundColor Cyan
Write-Host "  ssh ${VpsUser}@${VpsHost} `"docker exec $containerName ls /app/uploads/products/ | wc -l`""
Write-Host ""
