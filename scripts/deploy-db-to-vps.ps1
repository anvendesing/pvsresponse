<#
.SYNOPSIS
    Dump local Postgres DB, upload to VPS, and restore into production once.

.DESCRIPTION
    Use when local dev has catalog data configured but VPS does not.
    Does NOT wipe uploads volume or run full deploy — only replaces the DB.

    Prerequisites (local machine):
      - pg_dump installed (PostgreSQL client tools)
      - SSH access to VPS
      - Local DATABASE_URL pointing at your dev Postgres

    VPS prerequisites:
      - Docker Compose stack running (postgres + backend containers healthy)
      - pg_restore available on the VPS (comes with postgresql-client package)

.EXAMPLE
    .\scripts\deploy-db-to-vps.ps1 -VpsUser root

.EXAMPLE
    .\scripts\deploy-db-to-vps.ps1 -VpsUser root -DumpPath D:\backups\catalog.dump
#>

param(
    [string]$VpsHost = "217.216.78.119",
    [string]$VpsUser = "root",
    [string]$SshKey = "",
    [switch]$PasswordAuth,
    [string]$RepoPath = "",
    [string]$DumpPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. "$PSScriptRoot\lib\vps-connect.ps1"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $RepoRoot

$conn = Initialize-VpsConnection -VpsHost $VpsHost -VpsUser $VpsUser -SshKey $SshKey -PasswordAuth:$PasswordAuth
$RepoPath = Resolve-VpsRepoPath -SshOpts $conn.SshOpts -Target $conn.Target -RepoPath $RepoPath

if ($DumpPath) {
    $DumpLocal = (Resolve-Path $DumpPath).Path
    if (-not (Test-Path $DumpLocal)) { throw "Dump not found: $DumpPath" }
    Write-Host "=== Using existing dump ===" -ForegroundColor Cyan
} else {
    Write-Host "=== Step 1: Dump local Postgres database ===" -ForegroundColor Cyan
    $DumpLocal = Join-Path $RepoRoot "catalog.dump"

    # Read DATABASE_URL from backend\.env
    $envFile = Join-Path $RepoRoot "backend\.env"
    if (-not (Test-Path $envFile)) { throw "backend\.env not found — cannot read DATABASE_URL" }
    $dbUrl = (Get-Content $envFile | Where-Object { $_ -match "^DATABASE_URL=" } | Select-Object -First 1) -replace '^DATABASE_URL="?', '' -replace '"?$', ''
    if (-not $dbUrl -or $dbUrl -notmatch "^postgresql") {
        throw "DATABASE_URL in backend\.env does not look like a PostgreSQL URL: $dbUrl"
    }
    Write-Host "  DATABASE_URL: $dbUrl"
    Write-Host "  Dump target:  $DumpLocal"
    # pg_dump -Fc writes compressed custom format (compatible with pg_restore)
    pg_dump --dbname="$dbUrl" -Fc -f $DumpLocal
    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed — ensure PostgreSQL client tools are installed and the local DB is running." }
}

$sizeMb = [math]::Round((Get-Item $DumpLocal).Length / 1MB, 2)
Write-Host "  $DumpLocal ($sizeMb MB)"

Write-Host ""
Write-Host "=== Step 2: Upload dump to VPS ===" -ForegroundColor Cyan
$RemoteDump = "/tmp/catalog.dump"
Invoke-VpsScp -ScpOpts $conn.ScpOpts -Source $DumpLocal -TargetPath "$($conn.Target):$RemoteDump"

Write-Host ""
Write-Host "=== Step 3: Restore on VPS via pg_restore ===" -ForegroundColor Cyan
$pgContainer = "novaerp-postgres-1"  # docker compose project name + service name
$remoteCmd = @"
PGPASS=\$(docker exec $pgContainer printenv POSTGRES_PASSWORD 2>/dev/null || echo '')
docker stop novaerp-backend-1 2>/dev/null || true
docker exec -i -e PGPASSWORD="\$PGPASS" $pgContainer psql -U novaerp -d postgres -c "DROP DATABASE IF EXISTS novaerp;" 2>/dev/null || true
docker exec -e PGPASSWORD="\$PGPASS" $pgContainer psql -U novaerp -d postgres -c "CREATE DATABASE novaerp;"
docker exec -i -e PGPASSWORD="\$PGPASS" $pgContainer pg_restore -U novaerp -d novaerp --clean --if-exists < $RemoteDump
docker start novaerp-backend-1
rm -f $RemoteDump
"@
Write-Host "  Remote command: $remoteCmd"
Invoke-VpsSsh -SshOpts $conn.SshOpts -Target $conn.Target -Command $remoteCmd

Write-Host ""
Write-Host "Done. The VPS Postgres database has been replaced." -ForegroundColor Green
Write-Host "Backend will run prisma migrate deploy on restart and should come back healthy." -ForegroundColor DarkGray

Pop-Location
