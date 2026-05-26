import { useEffect, useRef, useState } from "react";

// =====================================================================
// BarcodeScanner
// =====================================================================
// Wraps the platform camera. Tries the native BarcodeDetector first;
// the fallback is intentionally a manual-entry input - we don't bundle
// a JS decoder in Phase 1 (keeps the install size tiny and Apple's
// camera-permission prompt sane).
//
// Phase 1.5 will add @zxing/browser as a fallback for browsers that
// don't ship BarcodeDetector (notably iOS Safari < 17).

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
    "init" | "ready" | "no-camera" | "no-detector" | "denied" | "error"
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
            // small haptic so the worker knows it caught
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
  }, [active, formats, onResult]);

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
              {state === "denied" && "Camera permission denied. Allow it in browser settings or type the code below."}
              {state === "no-camera" && "No camera detected on this device."}
              {state === "no-detector" && "This browser doesn't support live barcode scanning. Type the code below."}
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
