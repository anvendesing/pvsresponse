# Polls the BITS jobs every 30s; once both finish (Transferred), completes
# them, then runs setup-emulator.ps1 to unzip + boot + install + logcat.
# Output goes to a fixed log so we can read it after the fact.

$ErrorActionPreference = "Stop"
$logPath = "$env:TEMP\watch-and-run.log"
function Log($m) {
    $line = "$(Get-Date -Format 'HH:mm:ss')  $m"
    Add-Content -Path $logPath -Value $line
    Write-Host $line
}

Log "watcher started, polling BITS..."
while ($true) {
    $jobs = Get-BitsTransfer -ErrorAction SilentlyContinue
    if (-not $jobs) { Log "no jobs found"; break }

    $allDone = $true
    foreach ($j in $jobs) {
        $pct = [math]::Round(100 * $j.BytesTransferred / [math]::Max($j.BytesTotal,1), 1)
        Log ("  {0} {1} {2}%" -f $j.DisplayName, $j.JobState, $pct)
        if ($j.JobState -ne "Transferred") { $allDone = $false }
    }
    if ($allDone) {
        Log "all downloads complete - completing jobs..."
        Get-BitsTransfer | Complete-BitsTransfer
        break
    }
    Start-Sleep -Seconds 30
}

Log "running setup-emulator.ps1..."
$setup = "d:\coding\pvsresponse\mobile\scripts\setup-emulator.ps1"
& powershell -NoProfile -ExecutionPolicy Bypass -File $setup *>> "$env:TEMP\setup-emulator.log"
Log "setup complete. log: $env:TEMP\setup-emulator.log"
