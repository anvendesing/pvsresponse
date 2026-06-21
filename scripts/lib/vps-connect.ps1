# Shared SSH/SCP options for VPS deploy scripts.
# Dot-source from deploy-*.ps1:
#   . "$PSScriptRoot\lib\vps-connect.ps1"

function Initialize-VpsConnection {
    param(
        [Parameter(Mandatory = $true)]
        [string]$VpsHost,
        [Parameter(Mandatory = $true)]
        [string]$VpsUser,
        [string]$SshKey = "",
        [switch]$PasswordAuth,
        [int]$ConnectTimeoutSec = 20
    )

    $sshOpts = @(
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=$ConnectTimeoutSec"
    )
    $scpOpts = @(
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=$ConnectTimeoutSec"
    )

    if ($SshKey) {
        if (-not (Test-Path $SshKey)) {
            throw "SSH key not found: $SshKey"
        }
        $sshOpts += @("-i", $SshKey)
        $scpOpts += @("-i", $SshKey)
        Write-Host "SSH key: $SshKey" -ForegroundColor DarkGray
    } else {
        Write-Host ""
        Write-Host "Login: ${VpsUser}@${VpsHost} (password)" -ForegroundColor Cyan
        Write-Host "When Windows OpenSSH prompts for a password, enter your VPS login password." -ForegroundColor Yellow
        Write-Host "You may be asked 2-3 times (probe, scp upload, deploy command)." -ForegroundColor Yellow
        Write-Host ""
        if ($PasswordAuth) {
            # Force password when the server accepts both keys and password but you have no key loaded.
            $sshOpts += @("-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no")
            $scpOpts += @("-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no")
        }
    }

    return @{
        Target  = "${VpsUser}@${VpsHost}"
        SshOpts = $sshOpts
        ScpOpts = $scpOpts
    }
}

function Invoke-VpsSsh {
    param(
        [string[]]$SshOpts,
        [string]$Target,
        [string]$Command
    )
    & ssh @SshOpts $Target $Command
    if ($LASTEXITCODE -ne 0) { throw "SSH failed (exit $LASTEXITCODE)" }
}

function Invoke-VpsScp {
    param(
        [string[]]$ScpOpts,
        [string]$Source,
        [string]$TargetPath
    )
    & scp @ScpOpts $Source $TargetPath
    if ($LASTEXITCODE -ne 0) { throw "scp failed (exit $LASTEXITCODE)" }
}

function Resolve-VpsRepoPath {
    param(
        [string[]]$SshOpts,
        [string]$Target,
        [string]$RepoPath
    )
    if ($RepoPath) { return $RepoPath }
    foreach ($candidate in @("~/pvsresponse", "~/novaerp", "/root/pvsresponse", "/root/novaerp")) {
        $probe = "test -d $candidate/.git && echo $candidate"
        $found = & ssh @SshOpts $Target $probe 2>$null
        if ($LASTEXITCODE -eq 0 -and $found) {
            return $found.Trim()
        }
    }
    return "~/pvsresponse"
}
