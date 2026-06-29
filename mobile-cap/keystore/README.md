# Keystore setup (one-time)

**Never commit `release.jks` or `keystore.properties` to git.**
Both files are gitignored. Keep them in a password manager or secure vault.

## Generate the keystore

```powershell
keytool -genkey -v `
  -keystore release.jks `
  -alias prakruthivanam `
  -keyalg RSA `
  -keysize 2048 `
  -validity 10000 `
  -dname "CN=Prakruthivanam, OU=Mobile, O=Prakruthivanam Agri Pvt Ltd, L=Visakhapatnam, ST=Andhra Pradesh, C=IN"
```

## Create keystore.properties

Create `mobile-cap/keystore/keystore.properties` (never commit this file):

```properties
storeFile=../../keystore/release.jks
storePassword=YOUR_KEYSTORE_PASSWORD
keyAlias=prakruthivanam
keyPassword=YOUR_KEY_PASSWORD
```

## Build a signed AAB

```powershell
cd mobile-cap
npm run build:android
```

The signed AAB will be at:
`android/app/build/outputs/bundle/release/app-release.aab`

Upload this to Google Play Console → Production → Create new release.
