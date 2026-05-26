# Prakruthivanam Mobile — Android Install Guide

## What's in this folder

| File | Description |
|------|-------------|
| `PrakruthivanamShop-1.0.3.apk` | Latest debug/sideload build — defaults to production VPS |
| `PrakruthivanamShop-1.0.2.apk` | Previous build (required manual URL config) |

## Sideloading (fastest — no Play Store needed)

1. Enable **Developer Options** on your Android phone:
   - Settings → About Phone → tap **Build number** 7 times.
2. Enable **Install unknown apps** (Settings → Apps → Special app access → Install unknown apps → your file manager → Allow).
3. Copy `PrakruthivanamShop-1.0.3.apk` to the phone (USB, Google Drive, email, etc.) and tap to install.

**Or** install directly via ADB (phone connected by USB, USB debugging enabled):
```powershell
$sdk = "$env:LOCALAPPDATA\Android\Sdk\platform-tools"
& "$sdk\adb.exe" devices          # confirm device shows "device" (not "unauthorized")
& "$sdk\adb.exe" install -r "PrakruthivanamShop-1.0.3.apk"
```

## First launch

The app connects to the **production VPS at http://217.216.78.119** by default. No
Wi-Fi or local backend is required — it works over any internet connection (mobile data, home Wi-Fi, etc.).

You should see the Prakruthivanam home screen with 178+ products loaded.

## Changing the backend URL (optional)

Open the app → **Account** (bottom nav) → **API Settings** → **Configure**:

| Option | URL |
|--------|-----|
| Production VPS (default) | `http://217.216.78.119/v1` |
| Local dev (same Wi-Fi, emulator) | `http://10.0.2.2:4000/v1` |
| Local dev (real phone on LAN) | `http://192.168.x.x:4000/v1` |

Tap **"Use production VPS"** to reset to the live server, or type a custom URL and tap **"Save & Test"**.

## Rebuilding from source

```powershell
# Set Android SDK path (one-time — already set in User env after first build)
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"

cd d:\coding\pvsresponse

# Debug APK (fast, ~10s rebuild)
dotnet build mobile\PvsCommerce.Mobile.Android\PvsCommerce.Mobile.Android.csproj -c Debug

# Release APK (AOT-compiled, ~4 min, smaller install)
dotnet publish mobile\PvsCommerce.Mobile.Android\PvsCommerce.Mobile.Android.csproj -c Release -r android-arm64
# Output: mobile\PvsCommerce.Mobile.Android\bin\Release\net9.0-android\com.prakruthivanam.shop-Signed.apk
```

## Play Store preparation (future)

1. Create a release keystore:
   ```powershell
   keytool -genkey -v -keystore pvs-release.keystore `
     -alias pvs -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Publish with signing and AAB format:
   ```powershell
   dotnet publish mobile\PvsCommerce.Mobile.Android\PvsCommerce.Mobile.Android.csproj `
     -c Release -r android-arm64 `
     -p:AndroidPackageFormat=aab `
     -p:AndroidKeyStore=true `
     -p:AndroidSigningKeyStore=pvs-release.keystore `
     -p:AndroidSigningKeyAlias=pvs `
     -p:AndroidSigningKeyPass=<password> `
     -p:AndroidSigningStorePass=<password>
   ```
3. Upload the `.aab` to Play Console → Internal testing → Production.
