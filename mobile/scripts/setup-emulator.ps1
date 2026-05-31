#!/usr/bin/env pwsh
# Usage: powershell -File setup-emulator.ps1
# Unpacks the manually-downloaded emulator + system image into the SDK,
# creates a Pixel-style AVD, boots it, installs the signed APK, and tails
# logcat for Avalonia / AndroidRuntime errors.

$ErrorActionPreference = "Stop"
$sdk = "C:\Users\Sharath\AppData\Local\Android\Sdk"
$dl  = "$env:TEMP\android-dl"
$emuZip = "$dl\emulator.zip"
$siZip  = "$dl\sysimage.zip"
$avdName = "Pvs_Pixel"

$env:ANDROID_HOME     = $sdk
$env:ANDROID_SDK_ROOT = $sdk

Write-Host "=== 1. Unpack emulator → $sdk\emulator ==="
if (-not (Test-Path "$sdk\emulator\emulator.exe")) {
    Remove-Item "$sdk\emulator" -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path "$sdk" | Out-Null
    Expand-Archive -Path $emuZip -DestinationPath "$sdk" -Force
    Write-Host "  emulator unpacked."
} else { Write-Host "  emulator already installed." }

Write-Host "=== 2. Unpack system image → $sdk\system-images\android-34\google_apis\x86_64 ==="
$siRoot = "$sdk\system-images\android-34\google_apis"
if (-not (Test-Path "$siRoot\x86_64\system.img")) {
    New-Item -ItemType Directory -Force -Path $siRoot | Out-Null
    Expand-Archive -Path $siZip -DestinationPath $siRoot -Force
    Write-Host "  system image unpacked."
} else { Write-Host "  system image already installed." }

Write-Host "=== 3. Create AVD '$avdName' ==="
$avdManager = "$sdk\cmdline-tools\12.0\bin\avdmanager.bat"
$avdHome = "$env:USERPROFILE\.android\avd"
if (-not (Test-Path "$avdHome\$avdName.avd")) {
    "no" | & $avdManager create avd `
        --name $avdName `
        --package "system-images;android-34;google_apis;x86_64" `
        --device "pixel_5" `
        --force
    # Bump heap + screen for a more realistic phone test
    $cfg = "$avdHome\$avdName.avd\config.ini"
    $lines = Get-Content $cfg
    $lines = $lines -replace "^hw\.lcd\.density=.*", "hw.lcd.density=440"
    $lines = $lines -replace "^hw\.ramSize=.*", "hw.ramSize=4096"
    Set-Content -Path $cfg -Value $lines
    Add-Content -Path $cfg -Value "disk.dataPartition.size=4G"
    Write-Host "  AVD created."
} else { Write-Host "  AVD already exists." }

Write-Host "=== 4. Boot emulator ==="
$emuExe = "$sdk\emulator\emulator.exe"
$adb    = "$sdk\platform-tools\adb.exe"
$running = & $adb devices | Select-String "emulator-\d+\s+device"
if (-not $running) {
    Start-Process -FilePath $emuExe `
        -ArgumentList @("-avd", $avdName, "-no-snapshot-save", "-no-boot-anim", "-gpu", "auto") `
        -WindowStyle Hidden -PassThru | Out-Null
    Write-Host "  Waiting for boot..."
    & $adb wait-for-device
    while ((& $adb shell getprop sys.boot_completed 2>$null).Trim() -ne "1") {
        Start-Sleep -Seconds 2
        Write-Host "    booting..."
    }
    Write-Host "  Boot complete."
} else { Write-Host "  Emulator already running." }

Write-Host "=== 5. Install APK ==="
$apk = "d:\coding\pvsresponse\mobile\release\android\com.prakruthivanam.shop-Signed.apk"
if (-not (Test-Path $apk)) { throw "APK not found at $apk" }
& $adb install -r $apk

Write-Host "=== 6. Launch app + tail logcat ==="
& $adb logcat -c
& $adb shell am start -n com.prakruthivanam.shop/crc64c7f292194f5b1654.MainActivity
Start-Sleep -Seconds 3
& $adb logcat -v time AndroidRuntime:E Mono:V Avalonia:V *:S
