// Thin wrapper over @capacitor/* plugins.
// All exports are no-ops when running in a browser — safe to import
// everywhere without conditional checks in call sites.

// We use dynamic imports guarded by isApp so the Capacitor packages
// are tree-shaken out of the web bundle entirely.

const _isApp = (): boolean =>
  typeof window !== "undefined" &&
  !!(window as unknown as Record<string, unknown>)["Capacitor"];

// ── Token persistence (Preferences > localStorage on native) ────────────────

export const tokenStorage = {
  async getItem(key: string): Promise<string | null> {
    if (_isApp()) {
      const { Preferences } = await import("@capacitor/preferences");
      const { value } = await Preferences.get({ key });
      return value;
    }
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  async setItem(key: string, value: string): Promise<void> {
    if (_isApp()) {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.set({ key, value });
      return;
    }
    try { window.localStorage.setItem(key, value); } catch { /* noop */ }
  },
  async removeItem(key: string): Promise<void> {
    if (_isApp()) {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.remove({ key });
      return;
    }
    try { window.localStorage.removeItem(key); } catch { /* noop */ }
  },
};

// ── Status bar ───────────────────────────────────────────────────────────────

export const setStatusBarGreen = async (): Promise<void> => {
  if (!_isApp()) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#385f1c" });
  } catch { /* noop */ }
};

// ── Splash screen ────────────────────────────────────────────────────────────

export const hideSplash = async (): Promise<void> => {
  if (!_isApp()) return;
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide({ fadeOutDuration: 300 });
  } catch { /* noop */ }
};

// ── Network ──────────────────────────────────────────────────────────────────

export const getNetworkStatus = async (): Promise<boolean> => {
  if (!_isApp()) return navigator.onLine;
  try {
    const { Network } = await import("@capacitor/network");
    const status = await Network.getStatus();
    return status.connected;
  } catch { return navigator.onLine; }
};

// ── Share ────────────────────────────────────────────────────────────────────

export const shareProduct = async (title: string, url: string): Promise<void> => {
  if (_isApp()) {
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title, url, dialogTitle: "Share this product" });
      return;
    } catch { /* fall through to web share */ }
  }
  if (navigator.share) {
    try { await navigator.share({ title, url }); } catch { /* noop */ }
  }
};

// ── Push notifications ───────────────────────────────────────────────────────

export const registerPushToken = async (
  onToken: (token: string, platform: "fcm" | "apns") => void
): Promise<void> => {
  if (!_isApp()) return;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    const platform = info.id ? "fcm" : "fcm"; // FCM default; APNs handled by Capacitor iOS layer

    await PushNotifications.requestPermissions();
    await PushNotifications.register();
    PushNotifications.addListener("registration", ({ value }) => {
      onToken(value, platform);
    });
  } catch { /* noop */ }
};

// ── Android back button ──────────────────────────────────────────────────────

export const registerBackButton = (navigate: () => void): (() => void) => {
  if (!_isApp()) return () => undefined;
  let cleanup = () => undefined as void;
  import("@capacitor/app").then(({ App }) => {
    const handler = App.addListener("backButton", () => navigate());
    cleanup = () => { void handler.then((h) => h.remove()); };
  }).catch(() => undefined);
  return () => cleanup();
};

// ── In-app browser (payment return) ─────────────────────────────────────────

export const openInAppBrowser = async (url: string): Promise<void> => {
  if (_isApp()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url, presentationStyle: "popover" });
      return;
    } catch { /* fall through */ }
  }
  window.open(url, "_blank");
};
