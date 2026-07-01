import { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.prakruthivanam.shop",
  appName: "Prakruthivanam",
  webDir: "dist",
  server: {
    // In production the APK is self-contained (webDir bundle).
    // For dev testing against a local backend, uncomment and set the IP:
    // url: "http://192.168.x.x:5174",
    // cleartext: true,
  },
  android: {
    backgroundColor: "#385f1c",
    // allowMixedContent must be true when the backend is HTTP (not HTTPS).
    // The WebView loads from https://localhost internally; without this flag
    // Android blocks all http:// API calls as mixed content.
    // Remove once the VPS is behind a TLS domain.
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: "#385f1c",
      androidSplashResourceName: "splash",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#385f1c",
    },
  },
};

export default config;
