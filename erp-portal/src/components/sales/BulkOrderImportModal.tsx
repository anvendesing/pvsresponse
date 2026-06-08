// BulkOrderImportModal
// Opened from Quotes → "Import from Excel".
// Three-step flow:
//   1. Drop file + pick customer
//   2. Dry-run preview (accepted lines, rejected lines, stock warnings)
//   3. Confirm → creates Quote draft, navigates to it

import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Minus,
  Plus,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import {
  api,
  importQuoteXlsx,
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
  // Per-line edits applied between preview and confirm. Keyed by SKU
  // because each accepted line has a unique SKU in the source sheet.
  // - skipped: line was crossed out by the user, exclude from quote
  // - qty: override of the imported qty (undefined = keep imported)
  const [lineEdits, setLineEdits] = useState<Record<string, { skipped?: boolean; qty?: number }>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: customers } = useApi(() => api.customers(), []);

  // Effective lines = preview accepted minus skipped + qty overrides
  // applied. Memoised so totals + the table both read the same view.
  const effectiveAccepted = useMemo(() => {
    if (!preview) return [];
    return preview.accepted
      .filter((l) => !lineEdits[l.sku]?.skipped)
      .map((l) => {
        const override = lineEdits[l.sku]?.qty;
        const qty = override != null && override > 0 ? override : l.qty;
        return {
          ...l,
          qty,
          amount: Math.round(qty * l.rate * 100) / 100,
        };
      });
  }, [preview, lineEdits]);

  const effectiveSubTotal = useMemo(
    () => effectiveAccepted.reduce((s, l) => s + l.amount, 0),
    [effectiveAccepted]
  );
  // Re-derive tax linearly using the original ratio so users don't
  // need a separate tax recompute round-trip just to preview edits.
  const taxRate = preview && preview.subTotal > 0 ? preview.tax / preview.subTotal : 0.18;
  const effectiveTax = Math.round(effectiveSubTotal * taxRate * 100) / 100;
  const effectiveTotal = effectiveSubTotal + effectiveTax;

  // Derived label used by the "Product" column: parent name plus
  // size/uom when a variant is targeted, so 8 different agarbathi
  // variants don't all read as just "Agarbathi".
  const productLabel = (l: BulkOrderPreview["accepted"][number]): string => {
    const bits: string[] = [l.productName];
    if (l.variantSize) bits.push(l.variantSize);
    if (l.variantUom && (!l.variantSize || !l.variantSize.toLowerCase().includes(l.variantUom.toLowerCase()))) {
      bits.push(l.variantUom);
    }
    return bits.join(" · ");
  };

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
      // Reset any prior edits when a fresh preview comes in.
      setLineEdits({});
      setStep("preview");
    } catch (e) {
      setError((e as Error).message ?? "Preview failed.");
    } finally {
      setBusy(false);
    }
  };

  // ── Confirm import ──────────────────────────────────────────────
  // Previously this re-uploaded the file with dryRun=false, which
  // ignored any per-line skips/qty edits the user made on the
  // preview screen. Now we send the (filtered + edited) accepted
  // rows directly to POST /quotes — the price was already
  // re-resolved server-side during the preview, so the call is
  // safe to make from the client-side state.
  const confirmImport = async () => {
    if (!customerId) return;
    if (effectiveAccepted.length === 0) {
      setError("All lines were skipped — re-include at least one line or cancel.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.createQuote({
        customerId,
        notes: notes || undefined,
        items: effectiveAccepted.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          qty: l.qty,
          rate: l.rate,
          discount: l.discount,
        })),
      });
      setStep("done");
      onCreated?.(created.id, created.quoteNo);
      // Navigate after a short delay so the user sees the success message
      setTimeout(() => {
        onClose();
        navigate(`/quotes?focus=${created.id}`);
      }, 1500);
    } catch (e) {
      setError((e as Error).message ?? "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  // Per-line controls
  const toggleSkip = (sku: string) =>
    setLineEdits((prev) => ({
      ...prev,
      [sku]: { ...prev[sku], skipped: !prev[sku]?.skipped },
    }));

  const bumpQty = (sku: string, delta: number, fallback: number) => {
    setLineEdits((prev) => {
      const current = prev[sku]?.qty ?? fallback;
      const next = Math.max(1, current + delta);
      return { ...prev, [sku]: { ...prev[sku], qty: next } };
    });
  };

  const setQty = (sku: string, value: string) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    setLineEdits((prev) => ({
      ...prev,
      [sku]: { ...prev[sku], qty: Math.max(1, Math.round(n)) },
    }));
  };

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      {/* Width auto-adjusts: narrow on the upload step, wide on
          preview so the SKU + variant label + qty stepper + amount
          + skip-button row gets enough room for long agarbathi /
          siridhanyalu names without truncation. */}
      <div
        className={`relative bg-surface rounded-xl shadow-xl w-full mx-4 flex flex-col max-h-[90vh] ${
          step === "preview" ? "max-w-5xl" : "max-w-xl"
        }`}
      >
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
                ? `Preview — ${effectiveAccepted.length} of ${preview?.accepted.length ?? 0} lines selected`
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
            {/* Summary — uses live edits, not the raw preview */}
            <div className="grid grid-cols-3 gap-3">
              <Kpi
                label={
                  effectiveAccepted.length === preview.accepted.length
                    ? "Lines accepted"
                    : `Lines selected (of ${preview.accepted.length})`
                }
                value={String(effectiveAccepted.length)}
                tone="success"
              />
              <Kpi
                label="Lines rejected"
                value={String(preview.rejected.length)}
                tone={preview.rejected.length > 0 ? "danger" : "neutral"}
              />
              <Kpi label="Order total" value={inr(effectiveTotal)} tone="neutral" />
            </div>

            {/* Stock warnings — only flag lines whose live qty still exceeds stock */}
            {effectiveAccepted.some((l) => l.qty > l.stockOnHand) && (
              <div className="rounded-md bg-warning-soft border border-warning/30 px-3 py-2 text-body-sm text-ink-strong">
                <div className="flex items-center gap-1 font-semibold mb-1">
                  <AlertTriangle size={14} className="text-warning" />
                  Stock warnings — some quantities exceed available stock
                </div>
                <ul className="list-disc list-inside text-caption space-y-0.5">
                  {effectiveAccepted
                    .filter((l) => l.qty > l.stockOnHand)
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

            {/* Accepted lines table — supports per-line skip + qty edit */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-caption font-semibold text-ink-muted uppercase">
                  Accepted lines ({effectiveAccepted.length} of {preview.accepted.length})
                </div>
                {Object.keys(lineEdits).length > 0 && (
                  <button
                    type="button"
                    onClick={() => setLineEdits({})}
                    className="text-caption text-primary hover:underline"
                  >
                    Reset edits
                  </button>
                )}
              </div>
              <div className="border border-border rounded-md overflow-hidden">
                <div className="grid grid-cols-[220px_1fr_140px_120px_100px_32px] gap-3 px-3 py-1.5 bg-canvas border-b border-border text-caption font-semibold text-ink-muted">
                  <span>SKU</span>
                  <span>Product · Variant</span>
                  <span className="text-center">Qty</span>
                  <span className="text-right">Rate</span>
                  <span className="text-right">Amount</span>
                  <span />
                </div>
                <div className="divide-y divide-border max-h-[26rem] overflow-y-auto">
                  {preview.accepted.map((l) => {
                    const skipped = !!lineEdits[l.sku]?.skipped;
                    const qtyOverride = lineEdits[l.sku]?.qty;
                    const qty = qtyOverride != null ? qtyOverride : l.qty;
                    const amount = Math.round(qty * l.rate * 100) / 100;
                    const edited = qtyOverride != null && qtyOverride !== l.qty;
                    return (
                      <div
                        key={l.sku}
                        className={`grid grid-cols-[220px_1fr_140px_120px_100px_32px] gap-3 items-center px-3 py-1.5 text-body-sm ${
                          skipped
                            ? "bg-canvas opacity-50 line-through"
                            : l.stockWarning
                            ? "bg-warning-soft/30"
                            : ""
                        }`}
                      >
                        <span className="font-mono text-caption text-primary truncate" title={l.sku}>
                          {l.sku}
                        </span>
                        <span className="text-ink text-caption truncate pr-2" title={productLabel(l)}>
                          <span className="text-ink-strong">{l.productName}</span>
                          {(l.variantSize || l.variantUom) && (
                            <span className="text-ink-muted">
                              {" · "}
                              {l.variantSize ?? ""}
                              {l.variantSize && l.variantUom ? " " : ""}
                              {l.variantUom && (!l.variantSize || !l.variantSize.toLowerCase().includes(l.variantUom.toLowerCase()))
                                ? l.variantUom
                                : ""}
                            </span>
                          )}
                        </span>
                        {/* Qty cell: − N + */}
                        <span className="flex items-center gap-1 justify-center">
                          <button
                            type="button"
                            onClick={() => bumpQty(l.sku, -1, l.qty)}
                            disabled={skipped || qty <= 1}
                            className="h-6 w-6 grid place-items-center rounded border border-border bg-surface text-ink-muted hover:bg-canvas disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Decrease qty"
                          >
                            <Minus size={11} />
                          </button>
                          <input
                            type="number"
                            value={qty}
                            min={1}
                            disabled={skipped}
                            onChange={(e) => setQty(l.sku, e.target.value)}
                            className={`h-6 w-14 px-1.5 text-center tnum text-caption rounded border bg-surface focus:outline-none focus:ring-1 focus:ring-primary/40 ${
                              edited ? "border-primary text-primary font-semibold" : "border-border"
                            } disabled:opacity-50`}
                          />
                          <button
                            type="button"
                            onClick={() => bumpQty(l.sku, +1, l.qty)}
                            disabled={skipped}
                            className="h-6 w-6 grid place-items-center rounded border border-border bg-surface text-ink-muted hover:bg-canvas disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Increase qty"
                          >
                            <Plus size={11} />
                          </button>
                        </span>
                        <span className="text-right tnum text-caption text-ink-muted">{inr(l.rate)}</span>
                        <span className="text-right tnum text-caption font-semibold">{inr(amount)}</span>
                        <button
                          type="button"
                          onClick={() => toggleSkip(l.sku)}
                          className={`h-6 w-6 grid place-items-center rounded ${
                            skipped
                              ? "text-success hover:bg-success-soft"
                              : "text-ink-muted hover:bg-danger-soft hover:text-danger"
                          }`}
                          title={skipped ? "Re-include this line" : "Skip this line"}
                        >
                          {skipped ? <Plus size={13} /> : <X size={13} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Totals — recomputed from live edits */}
            <div className="border border-border rounded-md divide-y divide-border text-body-sm">
              <div className="flex justify-between px-3 py-1.5">
                <span className="text-ink-muted">Subtotal</span>
                <span className="tnum">{inr(effectiveSubTotal)}</span>
              </div>
              <div className="flex justify-between px-3 py-1.5">
                <span className="text-ink-muted">GST {Math.round(taxRate * 100)}%</span>
                <span className="tnum">{inr(effectiveTax)}</span>
              </div>
              <div className="flex justify-between px-3 py-1.5 font-bold">
                <span>Total</span>
                <span className="tnum">{inr(effectiveTotal)}</span>
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
              disabled={busy || effectiveAccepted.length === 0}
            >
              {busy ? "Creating…" : `Create Quote (${effectiveAccepted.length})`}
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
