// Ensures the Google Play Services barcode scanner module is present
// before calling BarcodeScanner.scan() on Android. The module is a
// dynamic download (~10 MB) on first use; without it scan() throws:
// "The Google Barcode Scanner Module is not available…"

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
}

export interface MlkitScanResult {
  barcodes?: Array<{ rawValue?: string; displayValue?: string }>;
}

export interface GoogleModuleInstallProgress {
  state: number;
  progress: number;
}

export interface PluginListenerHandle {
  remove: () => Promise<void>;
}

export interface MlkitPlugin {
  isSupported: () => Promise<{ supported: boolean }>;
  checkPermissions: () => Promise<{ camera: string }>;
  requestPermissions: () => Promise<{ camera: string }>;
  scan: (opts?: { formats?: string[] }) => Promise<MlkitScanResult>;
  isGoogleBarcodeScannerModuleAvailable?: () => Promise<{ available: boolean }>;
  installGoogleBarcodeScannerModule?: () => Promise<void>;
  addListener?: (
    eventName: "googleBarcodeScannerModuleInstallProgress",
    listener: (event: GoogleModuleInstallProgress) => void,
  ) => Promise<PluginListenerHandle>;
}

const MODULE_COMPLETED = 4;
const MODULE_FAILED = 5;
const MODULE_CANCELED = 3;

export const getNativeScanner = (): MlkitPlugin | null => {
  const win = window as unknown as {
    Capacitor?: CapacitorGlobal & {
      Plugins?: { BarcodeScanner?: MlkitPlugin };
    };
  };
  const cap = win.Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return cap.Plugins?.BarcodeScanner ?? null;
};

/** Download the Play Services scanner module if missing. No-op on web. */
export async function ensureGoogleBarcodeModule(
  native: MlkitPlugin,
  onProgress?: (percent: number) => void,
): Promise<void> {
  if (!native.isGoogleBarcodeScannerModuleAvailable) return;

  const { available } = await native.isGoogleBarcodeScannerModuleAvailable();
  if (available) return;

  if (!native.installGoogleBarcodeScannerModule || !native.addListener) {
    throw new Error(
      "Google barcode scanner is not installed. Connect to Wi‑Fi and try again.",
    );
  }

  await new Promise<void>((resolve, reject) => {
    let listenerHandle: PluginListenerHandle | null = null;

    void (async () => {
      try {
        listenerHandle = await native.addListener!(
          "googleBarcodeScannerModuleInstallProgress",
          (event) => {
            onProgress?.(event.progress);
            if (event.state === MODULE_COMPLETED) {
              void listenerHandle?.remove();
              resolve();
            } else if (event.state === MODULE_FAILED) {
              void listenerHandle?.remove();
              reject(
                new Error(
                  "Scanner module download failed. Check Wi‑Fi and try again.",
                ),
              );
            } else if (event.state === MODULE_CANCELED) {
              void listenerHandle?.remove();
              reject(new Error("Scanner module download was canceled."));
            }
          },
        );
        await native.installGoogleBarcodeScannerModule!();
      } catch (err) {
        void listenerHandle?.remove();
        reject(err);
      }
    })();
  });

  const after = await native.isGoogleBarcodeScannerModuleAvailable();
  if (!after.available) {
    throw new Error(
      "Scanner module is still unavailable. Connect to Wi‑Fi and reopen the app.",
    );
  }
}

/** Fire-and-forget preload on app start so the first scan is instant. */
export function preloadGoogleBarcodeModule(): void {
  const native = getNativeScanner();
  if (!native) return;
  void ensureGoogleBarcodeModule(native).catch(() => {
    // First scan will retry; avoid blocking login on a flaky network.
  });
}
