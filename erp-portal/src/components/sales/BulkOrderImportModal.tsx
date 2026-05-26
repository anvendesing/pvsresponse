// BulkOrderImportModal
// Opened from Quotes → "Import from Excel".
// Three-step flow:
//   1. Drop file + pick customer
//   2. Dry-run preview (accepted lines, rejected lines, stock warnings)
//   3. Confirm → creates Quote draft, navigates to it

import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import {
  api,
  importQuoteXlsx,
  type BulkOrderImportResult,
  type BulkOrderPreview,
} from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { inr } from "@/lib/format";

interface Props {
  onClose: () => void;
  onCreated?: (quoteId: string, quoteNo: string) => void;
}

type Step = "upload" | "preview" | "done";

export const BulkOrderImportModal = ({ onClose, onCreated }: Props) => {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [notes, setNotes] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<BulkOrderPreview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: customers } = useApi(() => api.customers(), []);

  // ── File selection ──────────────────────────────────────────────
  const pickFile = (f: File) => {
    if (!f.name.endsWith(".xlsx")) {
      setError("Only .xlsx files are supported.");
      return;
    }
    setFile(f);
    setError(null);
  };

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) pickFile(f);
    },
    []
  );

  // ── Dry-run preview ─────────────────────────────────────────────
  const runPreview = async () => {
    if (!file) { setError("Select a file first."); return; }
    if (!customerId) { setError("Select a customer."); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await importQuoteXlsx(file, customerId, {
        notes: notes || undefined,
        dryRun: true,
      });
      setPreview(result as BulkOrderPreview);
      setStep("preview");
    } catch (e) {
      setError((e as Error).message ?? "Preview failed.");
    } finally {
      setBusy(false);
    }
  };

  // ── Confirm import ──────────────────────────────────────────────
  const confirmImport = async () => {
    if (!file || !customerId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importQuoteXlsx(file, customerId, {
        notes: notes || undefined,
        dryRun: false,
      });
      const res = result as BulkOrderImportResult;
      setStep("done");
      onCreated?.(res.quoteId, res.quoteNo);
      // Navigate after a short delay so the user sees the success message
      setTimeout(() => {
        onClose();
        navigate(`/quotes?focus=${res.quoteId}`);
      }, 1500);
    } catch (e) {
      setError((e as Error).message ?? "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="relative bg-surface rounded-xl shadow-xl w-full max-w-xl mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-canvas rounded-t-xl flex-shrink-0">
          <FileSpreadsheet size={20} className="text-primary" />
          <div className="flex-1">
            <div className="font-semibold text-body-sm text-ink-strong">
              Import Bulk Order from Excel
            </div>
            <div className="text-caption text-ink-muted">
              {step === "upload"
                ? "Upload a bulk-order .xlsx exported from Price Lists"
                : step === "preview"
                ? `Preview — ${preview?.accepted.length ?? 0} lines accepted`
                : "Quote created successfully"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 grid place-items-center rounded text-ink-muted hover:bg-surface-hover"
          >
            <X size={14} />
          </button>
        </div>

        {/* Step 1: Upload */}
        {step === "upload" && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                dragOver
                  ? "border-primary bg-primary-50"
                  : file
                  ? "border-success bg-success-soft"
                  : "border-border hover:border-primary/40 hover:bg-canvas"
              }`}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); }}
              />
              {file ? (
                <div className="flex items-center justify-center gap-2 text-success">
                  <CheckCircle2 size={20} />
                  <span className="font-semibold text-body-sm">{file.name}</span>
                  <button
                    className="ml-2 text-ink-muted hover:text-danger"
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <Upload size={28} className="mx-auto mb-2 text-ink-muted" />
                  <div className="text-body-sm text-ink-muted">
                    Drop a bulk-order .xlsx here or{" "}
                    <span className="text-primary underline">browse</span>
                  </div>
                  <div className="text-caption text-ink-muted mt-1">
                    Only files exported from this system are accepted
                  </div>
                </>
              )}
            </div>

            {/* Customer selector */}
            <div>
              <label className="block text-caption font-semibold text-ink-muted uppercase mb-1">
                Customer <span className="text-danger">*</span>
              </label>
              <select
                className="h-9 w-full bg-canvas border border-border rounded-md px-2 text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">— Select customer —</option>
                {(customers ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-caption font-semibold text-ink-muted uppercase mb-1">
                Internal note <span className="text-ink-muted font-normal">(optional)</span>
              </label>
              <input
                type="text"
                className="h-9 w-full bg-canvas border border-border rounded-md px-2 text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="e.g. Monthly standing order"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {error && (
              <div className="rounded-md bg-danger-soft border border-danger/30 px-3 py-2 text-body-sm text-danger flex items-start gap-2">
                <XCircle size={14} className="flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Preview */}
        {step === "preview" && preview && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3">
              <Kpi label="Lines accepted" value={String(preview.accepted.length)} tone="success" />
              <Kpi label="Lines rejected" value={String(preview.rejected.length)} tone={preview.rejected.length > 0 ? "danger" : "neutral"} />
              <Kpi label="Order total" value={inr(preview.total)} tone="neutral" />
            </div>

            {/* Stock warnings */}
            {preview.accepted.some((l) => l.stockWarning) && (
              <div className="rounded-md bg-warning-soft border border-warning/30 px-3 py-2 text-body-sm text-ink-strong">
                <div className="flex items-center gap-1 font-semibold mb-1">
                  <AlertTriangle size={14} className="text-warning" />
                  Stock warnings — some quantities exceed available stock
                </div>
                <ul className="list-disc list-inside text-caption space-y-0.5">
                  {preview.accepted
                    .filter((l) => l.stockWarning)
                    .map((l) => (
                      <li key={l.sku}>
                        <span className="font-mono">{l.sku}</span> — requested{" "}
                        <strong>{l.qty}</strong>, available{" "}
                        <strong>{l.stockOnHand}</strong>
                      </li>
                    ))}
                </ul>
              </div>
            )}

            {/* Rejected lines */}
            {preview.rejected.length > 0 && (
              <div className="rounded-md bg-danger-soft border border-danger/30 px-3 py-2">
                <div className="flex items-center gap-1 font-semibold text-body-sm text-danger mb-1">
                  <XCircle size={14} />
                  {preview.rejected.length} line{preview.rejected.length !== 1 ? "s" : ""} rejected
                </div>
                <ul className="text-caption space-y-0.5">
                  {preview.rejected.map((r) => (
                    <li key={r.sku + r.row} className="flex gap-2">
                      <span className="font-mono text-ink-muted">row {r.row}</span>
                      <span className="font-mono font-semibold">{r.sku}</span>
                      <span className="text-ink-muted">— {r.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Accepted lines table */}
            <div>
              <div className="text-caption font-semibold text-ink-muted uppercase mb-1">
                Accepted lines ({preview.accepted.length})
              </div>
              <div className="border border-border rounded-md overflow-hidden">
                <div className="grid grid-cols-[1fr_1fr_auto_auto] px-3 py-1.5 bg-canvas border-b border-border text-caption font-semibold text-ink-muted">
                  <span>SKU</span><span>Product</span><span className="text-right">Qty</span><span className="text-right pr-1">Amount</span>
                </div>
                <div className="divide-y divide-border max-h-60 overflow-y-auto">
                  {preview.accepted.map((l) => (
                    <div
                      key={l.sku}
                      className={`grid grid-cols-[1fr_1fr_auto_auto] px-3 py-1.5 text-body-sm ${l.stockWarning ? "bg-warning-soft/30" : ""}`}
                    >
                      <span className="font-mono text-caption text-primary">{l.sku}</span>
                      <span className="text-ink-muted text-caption truncate pr-2">{l.productName}</span>
                      <span className="text-right tnum font-semibold">{l.qty}</span>
                      <span className="text-right tnum pr-1">{inr(l.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Totals */}
            <div className="border border-border rounded-md divide-y divide-border text-body-sm">
              <div className="flex justify-between px-3 py-1.5">
                <span className="text-ink-muted">Subtotal</span>
                <span className="tnum">{inr(preview.subTotal)}</span>
              </div>
              <div className="flex justify-between px-3 py-1.5">
                <span className="text-ink-muted">GST 18%</span>
                <span className="tnum">{inr(preview.tax)}</span>
              </div>
              <div className="flex justify-between px-3 py-1.5 font-bold">
                <span>Total</span>
                <span className="tnum">{inr(preview.total)}</span>
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-danger-soft border border-danger/30 px-3 py-2 text-body-sm text-danger flex items-start gap-2">
                <XCircle size={14} className="flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Done */}
        {step === "done" && (
          <div className="flex-1 flex flex-col items-center justify-center py-12 px-5 gap-3">
            <CheckCircle2 size={48} className="text-success" />
            <div className="font-semibold text-body-sm">Quote created! Redirecting…</div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-between gap-2 px-5 py-3 border-t border-border bg-canvas rounded-b-xl flex-shrink-0">
          {step === "preview" && (
            <Button variant="ghost" size="sm" onClick={() => setStep("upload")} disabled={busy}>
              ← Back
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {step === "upload" && (
            <Button
              size="sm"
              icon={<FileSpreadsheet size={14} />}
              onClick={runPreview}
              disabled={busy || !file || !customerId}
            >
              {busy ? "Checking…" : "Preview order"}
            </Button>
          )}
          {step === "preview" && (
            <Button
              size="sm"
              icon={<CheckCircle2 size={14} />}
              onClick={confirmImport}
              disabled={busy || (preview?.accepted.length ?? 0) === 0}
            >
              {busy ? "Creating…" : "Create Quote"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

// Mini KPI for the preview summary
const Kpi = ({ label, value, tone }: { label: string; value: string; tone: "success" | "danger" | "neutral" }) => {
  const toneClass =
    tone === "success" ? "text-success bg-success-soft border-success/20"
    : tone === "danger" ? "text-danger bg-danger-soft border-danger/20"
    : "text-ink-strong bg-canvas border-border";
  return (
    <div className={`rounded-md border px-3 py-2 text-center ${toneClass}`}>
      <div className="text-lg font-bold tnum">{value}</div>
      <div className="text-caption">{label}</div>
    </div>
  );
};
