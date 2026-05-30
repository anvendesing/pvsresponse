import { useEffect, useRef, useState } from "react";

// =====================================================================
// BarcodeScanner
// =====================================================================
// Wraps the platform camera. Order of preference:
//   1. Capacitor + @capacitor-mlkit/barcode-scanning (when running
//      inside our wrapped Android APK) - real native ML Kit, fast,
//      reliable on every Android phone.
//   2. Web BarcodeDetector API (Chrome / Edge desktop dev).
//   3. Manual entry fallback (worker types the code).
//
// Phase 1.5 will also add @zxing/browser for iOS Safari < 17.
//
// We deliberately avoid bundling a JS decoder by default to keep the
// install size tiny - the native plugin already handles the slow path
// for us on Android.

// Lightweight type for the Capacitor global without taking a
// compile-time dep on @capacitor/core (which isn't in this package).
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

interface MlkitScanResult {
  barcodes?: Array<{ rawValue?: string; displayValue?: string }>;
}
interface MlkitPlugin {
  isSupported: () => Promise<{ supported: boolean }>;
  checkPermissions: () => Promise<{ camera: string }>;
  requestPermissions: () => Promise<{ camera: string }>;
  scan: (opts?: { formats?: string[] }) => Promise<MlkitScanResult>;
}

const getNativeScanner = (): MlkitPlugin | null => {
  const win = window as unknown as {
    Capacitor?: CapacitorGlobal & {
      Plugins?: { BarcodeScanner?: MlkitPlugin };
    };
  };
  const cap = win.Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return cap.Plugins?.BarcodeScanner ?? null;
};

// Map the web format ids we already use to the ML Kit ones (which take
// upper-case enum names).
const toMlkitFormats = (formats: string[]): string[] =>
  formats
    .map((f) => {
      switch (f) {
        case "qr_code": return "QR_CODE";
        case "code_128": return "CODE_128";
        case "code_39": return "CODE_39";
        case "code_93": return "CODE_93";
        case "ean_13": return "EAN_13";
        case "ean_8": return "EAN_8";
        case "upc_a": return "UPC_A";
        case "upc_e": return "UPC_E";
        case "data_matrix": return "DATA_MATRIX";
        case "pdf_417": return "PDF_417";
        case "itf": return "ITF";
        case "codabar": return "CODABAR";
        case "aztec": return "AZTEC";
        default: return "";
      }
    })
    .filter(Boolean);

interface Props {
  active: boolean;
  onResult: (text: string) => void;
  onClose: () => void;
  // Optional list of expected formats (passed straight through to the
  // BarcodeDetector). Defaults to a sensible warehouse mix.
  formats?: string[];
}

const DEFAULT_FORMATS = [
  "qr_code",
  "code_128",
  "code_39",
  "code_93",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "data_matrix",
];

export const BarcodeScanner = ({
  active,
  onResult,
  onClose,
  formats = DEFAULT_FORMATS,
}: Props) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<
    "init" | "ready" | "scanning-native" | "no-camera" | "no-detector" | "denied" | "error"
  >("init");
  const [manual, setManual] = useState("");
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let detector: { detect: (s: HTMLVideoElement) => Promise<{ rawValue: string }[]> } | null = null;
    let frameId: number | null = null;
    let lastSeen = "";

    // -----------------------------------------------------------------
    // Path 1: Capacitor native ML Kit scanner (Android APK).
    // -----------------------------------------------------------------
    // The plugin's scan() opens a full-screen Google ML Kit camera
    // activity, returns the first code scanned. We don't render our
    // own preview in this path - the plugin owns the camera.
    const native = getNativeScanner();
    if (native) {
      setState("scanning-native");
      (async () => {
        try {
          const supported = await native.isSupported();
          if (!supported.supported) {
            if (!cancelled) {
              setState("no-detector");
              setLastError("ML Kit barcode module not available on this device.");
            }
            return;
          }
          let perm = await native.checkPermissions();
          if (perm.camera !== "granted") {
            perm = await native.requestPermissions();
          }
          if (perm.camera !== "granted") {
            if (!cancelled) setState("denied");
            return;
          }
          const result = await native.scan({ formats: toMlkitFormats(formats) });
          if (cancelled) return;
          const code = result.barcodes?.[0]?.rawValue ?? result.barcodes?.[0]?.displayValue;
          if (code) {
            if (navigator.vibrate) navigator.vibrate(40);
            onResult(code);
          } else {
            // User cancelled or nothing scanned. Fall back to manual.
            setState("no-detector");
            setLastError("No barcode detected. Type the code below.");
          }
        } catch (err) {
          if (cancelled) return;
          const msg = (err as Error).message ?? "scan_failed";
          if (msg.toLowerCase().includes("cancel")) {
            // Treat user cancel as a soft close, not an error.
            onClose();
            return;
          }
          setState("error");
          setLastError(msg);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    // -----------------------------------------------------------------
    // Path 2: Web BarcodeDetector API (Chrome / Edge desktop dev).
    // -----------------------------------------------------------------
    const start = async () => {
      // Detect support before we hit the camera so a denied permission
      // doesn't waste a stream we'd never read.
      const Detector = (window as { BarcodeDetector?: new (opts?: { formats?: string[] }) => typeof detector }).BarcodeDetector;
      if (!Detector) {
        setState("no-detector");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (err) {
        const e = err as DOMException;
        if (e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError") {
          setState("denied");
        } else if (e?.name === "NotFoundError") {
          setState("no-camera");
        } else {
          setState("error");
          setLastError(e?.message ?? "camera_failed");
        }
        return;
      }
      if (cancelled) return;
      try {
        detector = new Detector({ formats }) as unknown as typeof detector;
      } catch {
        setState("no-detector");
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      setState("ready");

      const tick = async () => {
        if (cancelled || !detector || !video) return;
        try {
          const codes = await detector.detect(video);
          if (codes && codes[0]?.rawValue && codes[0].rawValue !== lastSeen) {
            lastSeen = codes[0].rawValue;
            if (navigator.vibrate) navigator.vibrate(40);
            onResult(codes[0].rawValue);
            return;
          }
        } catch {
          // ignore per-frame failures - they happen on aggressive AF
        }
        frameId = requestAnimationFrame(() => void tick());
      };
      void tick();
    };
    void start();

    return () => {
      cancelled = true;
      if (frameId != null) cancelAnimationFrame(frameId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [active, formats, onResult, onClose]);

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between bg-black/60 px-4 py-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <span className="text-sm font-semibold">Scan barcode</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-white/10 px-3 py-1 text-xs"
        >
          Close
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {state === "ready" && (
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {state === "ready" && (
          <div className="pointer-events-none absolute inset-x-10 top-1/3 bottom-1/3 rounded-2xl border-2 border-white/80" />
        )}
        {state !== "ready" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-base">
              {state === "init" && "Starting camera…"}
              {state === "scanning-native" && "Native ML Kit scanner is open. Aim at the barcode…"}
              {state === "denied" && "Camera permission denied. Allow it in Settings → Apps → NovaERP Warehouse → Permissions, or type the code below."}
              {state === "no-camera" && "No camera detected on this device."}
              {state === "no-detector" && (lastError ?? "This browser doesn't support live barcode scanning. Type the code below.")}
              {state === "error" && (lastError ?? "Camera failed to start.")}
            </p>
          </div>
        )}
      </div>

      {/* Manual entry - always visible so a worker can fall back to
          typing if the camera misreads a worn label. */}
      <form
        className="bg-black/80 p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) onResult(manual.trim());
        }}
      >
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Type code…"
            className="flex-1 rounded-xl bg-white/10 px-4 py-2 text-base placeholder:text-white/50 focus:bg-white/15 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!manual.trim()}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Use
          </button>
        </div>
      </form>
    </div>
  );
};
