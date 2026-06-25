import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import { BarcodeScanner } from "../BarcodeScanner";

// =====================================================================
// /m/scan
// =====================================================================
// Camera-first landing page. Resolves whatever the worker scans:
//   - bin/shelf/zone -> drill into MobileLocation
//   - product SKU/barcode -> drill into MobileLocation as a product card
// Manual entry stays available so a faded label can still be punched in.

export const MobileScan = () => {
  const nav = useNavigate();
  const [scanning, setScanning] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);

  const handleCode = async (raw: string) => {
    setBusy(true);
    setError(null);
    setLast(raw);
    setScanning(false);
    try {
      const result = (await api.resolveLocation(raw)) as {
        kind: "zone" | "shelf" | "bin" | "product";
        bin?: { id?: string };
        code?: string;
      };
      const navCode = encodeURIComponent(result.code ?? raw);
      if (result.kind === "bin" && result.bin?.id) {
        void api
          .logScanEvent({
            kind: "bin",
            code: raw,
            outcome: "ok",
            context: "verify",
          })
          .catch(() => undefined);
        nav(`/m/bin/${result.bin.id}`);
      } else if (result.kind === "shelf") {
        void api
          .logScanEvent({
            kind: "shelf",
            code: raw,
            outcome: "ok",
            context: "verify",
          })
          .catch(() => undefined);
        nav(`/m/loc/${navCode}`);
      } else if (result.kind === "zone") {
        void api
          .logScanEvent({
            kind: "zone",
            code: raw,
            outcome: "ok",
            context: "verify",
          })
          .catch(() => undefined);
        nav(`/m/loc/${navCode}`);
      } else if (result.kind === "product") {
        nav(`/m/loc/${navCode}`);
      } else {
        nav(`/m/loc/${navCode}`);
      }
    } catch (err) {
      void api
        .logScanEvent({
          kind: "unknown",
          code: raw,
          outcome:
            err instanceof ApiError && err.status === 404 ? "not_found" : "mismatch",
          context: "verify",
        })
        .catch(() => undefined);
      setError(
        err instanceof ApiError
          ? err.message
          : (err as Error).message ?? "Could not resolve code."
      );
      setScanning(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 pt-4">
      <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-base font-semibold text-slate-900">Scan a label</h2>
        <p className="mt-1 text-sm text-slate-500">
          Point the camera at a zone (e.g. WSP.A), shelf (WSP.AS05), bin, or product
          label. The app opens the matching screen with expandable bin lists.
        </p>
        <button
          type="button"
          onClick={() => setScanning(true)}
          disabled={busy}
          className="mt-3 w-full rounded-xl bg-[#003087] py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Resolving…" : "Open camera"}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {error}
          {last && <div className="mt-1 font-mono text-xs">scanned: {last}</div>}
        </div>
      )}

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Or type a code
        </h3>
        <ManualForm onSubmit={handleCode} />
      </div>

      <BarcodeScanner
        active={scanning}
        onResult={(t) => void handleCode(t)}
        onClose={() => setScanning(false)}
      />
    </div>
  );
};

const ManualForm = ({ onSubmit }: { onSubmit: (s: string) => void }) => {
  const [code, setCode] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) onSubmit(code.trim());
      }}
      className="flex gap-2"
    >
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="WSP.AS05 or WSP.AS05.11"
        autoCapitalize="characters"
        autoCorrect="off"
        className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:outline-none"
      />
      <button
        type="submit"
        disabled={!code.trim()}
        className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        Go
      </button>
    </form>
  );
};
