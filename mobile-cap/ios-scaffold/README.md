# iOS project setup (requires Mac with Xcode)

The iOS Capacitor project must be scaffolded on a Mac. Run these commands
after checking out this repo on a Mac with Xcode 15+ installed:

```bash
cd mobile-cap

# 1. Build the React app and copy dist → www
npm run build:web
npm run copy:dist

# 2. Scaffold the iOS project (only needed once)
npx cap add ios

# 3. Apply plugin dependencies
npx cap sync ios

# 4. Generate icons + splashes for iOS
npx @capacitor/assets generate --ios \
  --iconBackgroundColor "#385f1c" \
  --splashBackgroundColor "#385f1c"

# 5. Copy the PrivacyInfo.xcprivacy into the Xcode project
cp ios-scaffold/PrivacyInfo.xcprivacy ios/App/App/PrivacyInfo.xcprivacy

# 6. Open Xcode and configure:
npx cap open ios
```

## In Xcode

1. Signing & Capabilities → select your Apple Developer team.
2. Bundle ID must be `com.prakruthivanam.shop`.
3. Add `Push Notifications` capability.
4. Add `Associated Domains` capability with entry `applinks:yourdomain.com`.
5. Merge `ios-scaffold/Info.plist.additions.xml` entries into
   `ios/App/App/Info.plist`.
6. Add `PrivacyInfo.xcprivacy` to the `App` target in the project navigator
   (drag it in; it should be in the same folder as `Info.plist`).

## Build for TestFlight

```
Product → Archive → Distribute App → App Store Connect
```

The `.well-known/apple-app-site-association` file is already served by the
backend on `GET /.well-known/apple-app-site-association`.
Replace `TEAMID` in the JSON with your 10-character Apple Team ID.
