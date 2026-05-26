// ReturnImportModal
// Three-step import flow for Customer Returns:
//   1. Upload (.xlsx file) + pick customer + optional invoice anchor
//   2. Dry-run preview (accepted lines + rejected lines)
//   3. Commit → CustomerReturn created; caller navigates to the drawer

import { useCallback, useRef, useState } from "react";
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
  apiEnabled,
  importReturnXlsx,
  type ReturnImportPreview,
  type ReturnImportResult,
} from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { inr } from "@/lib/format";

interface Props {
  onClose: () => void;
  onCreated: (returnId: string, returnNo: string) => void;
}

type Step = "upload" | "preview" | "done";

export const ReturnImportModal = ({ onClose, onCreated }: Props) => {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [notes, setNotes] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReturnImportPreview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: customers } = useApi(() => (apiEnabled ? api.customers() : Promise.resolve([])), []);
  const { data: openInvoices } = useApi(
    () =>
      customerId && apiEnabled
        ? api.customerOpenInvoices(customerId)
        : Promise.resolve([]),
    [customerId]
  );

  const pickFile = (f: File) => {
    if (!f.name.endsWith(".xlsx")) {
      setError("Only .xlsx files are supported.");
      return;
    }
    setFile(f);
    setError(null);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) pickFile(f);
  }, []);

  const runPreview = async () => {
    if (!file) { setError("Select a file first."); return; }
    if (!customerId) { setError("Select a customer."); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await importReturnXlsx(file, customerId, {
        invoiceId: invoiceId || undefined,
        notes: notes || undefined,
        dryRun: true,
      });
      setPreview(result as ReturnImportPreview);
      setStep("preview");
    } catch (e) {
      setError((e as Error).message ?? "Preview failed.");
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!file || !customerId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importReturnXlsx(file, customerId, {
        invoiceId: invoiceId || undefined,
        notes: notes || undefined,
        dryRun: false,
      });
      const res = result as ReturnImportResult;
      setStep("done");
      onCreated(res.returnId, res.returnNo);
    } catch (e) {
      setError((e as Error).message ?? "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="relative bg-surface rounded-xl shadow-xl w-full max-w-xl mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-canvas rounded-t-xl flex-shrink-0">
          <FileSpreadsheet size={20} className="text-primary" />
          <div className="flex-1">
            <div className="font-semibold text-body-sm text-ink-strong">
              Import Returns from Excel
            </div>
            <div className="text-caption text-ink-muted">
              {step === "upload"
                ? "Upload a returns .xlsx (SKU | QTY | REASON | NOTES)"
                : step === "preview"
                ? `Preview — ${preview?.accepted.length ?? 0} line(s) accepted`
                : "Return created — awaiting approval"}
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
                    Drag & drop a <strong>.xlsx</strong> file, or click to browse
                  </div>
                  <div className="text-caption text-ink-muted mt-1">
                    Columns: SKU · QTY · REASON · NOTES (optional)
                  </div>
                </>
              )}
            </div>

            {/* Customer picker */}
            <div className="space-y-1">
              <label className="text-body-sm font-semibold">Customer *</label>
              <select
                value={customerId}
                onChange={(e) => { setCustomerId(e.target.value); setInvoiceId(""); }}
                className="w-full border border-border rounded-md px-3 py-2 text-body-sm bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">— Select customer —</option>
                {(customers ?? []).map((c: { id: string; code: string; name: string }) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Optional invoice anchor */}
            {customerId && (openInvoices?.length ?? 0) > 0 && (
              <div className="space-y-1">
                <label className="text-body-sm font-semibold">
                  Anchor Invoice <span className="font-normal text-ink-muted">(optional — ties all return lines to one invoice)</span>
                </label>
                <select
                  value={invoiceId}
                  onChange={(e) => setInvoiceId(e.target.value)}
                  className="w-full border border-border rounded-md px-3 py-2 text-body-sm bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">— Auto-resolve per SKU (recommended) —</option>
                  {(openInvoices ?? []).map((inv: { id: string; invoiceNo: string; openAmount: number }) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoiceNo} · open {inr(inv.openAmount)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Notes */}
            <div className="space-y-1">
              <label className="text-body-sm font-semibold">Notes <span className="font-normal text-ink-muted">(optional)</span></label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="e.g. Batch return from delivery route 4"
                className="w-full border border-border rounded-md px-3 py-2 text-body-sm bg-surface focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 text-danger text-body-sm bg-danger-soft border border-danger/30 rounded-md p-3">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Preview */}
        {step === "preview" && preview && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Accepted lines */}
            {preview.accepted.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 size={16} className="text-success" />
                  <span className="text-body-sm font-semibold text-success">
                    {preview.accepted.length} line(s) accepted
                  </span>
                </div>
                <table className="w-full text-caption border border-border rounded-md overflow-hidden">
                  <thead className="bg-canvas">
                    <tr>
                      <th className="text-left px-2 py-1.5 text-ink-muted">SKU</th>
                      <th className="text-right px-2 py-1.5 text-ink-muted">Qty</th>
                      <th className="text-right px-2 py-1.5 text-ink-muted">Rate</th>
                      <th className="text-right px-2 py-1.5 text-ink-muted">Amount</th>
                      <th className="text-left px-2 py-1.5 text-ink-muted">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {preview.accepted.map((l) => (
                      <tr key={l.sku} className="hover:bg-canvas">
                        <td className="px-2 py-1.5 font-mono text-primary">{l.sku}</td>
                        <td className="px-2 py-1.5 text-right tnum">{l.qty}</td>
                        <td className="px-2 py-1.5 text-right tnum">{inr(l.rate)}</td>
                        <td className="px-2 py-1.5 text-right tnum font-semibold">{inr(l.amount)}</td>
                        <td className="px-2 py-1.5 text-ink-muted capitalize">{l.reason.replace(/_/g, " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-canvas">
                    <tr>
                      <td colSpan={3} className="px-2 py-1.5 text-right font-semibold">Subtotal</td>
                      <td className="px-2 py-1.5 text-right tnum font-semibold">{inr(preview.subTotal)}</td>
                      <td />
                    </tr>
                    <tr>
                      <td colSpan={3} className="px-2 py-1.5 text-right text-ink-muted">Tax (18%)</td>
                      <td className="px-2 py-1.5 text-right tnum text-ink-muted">{inr(preview.tax)}</td>
                      <td />
                    </tr>
                    <tr>
                      <td colSpan={3} className="px-2 py-1.5 text-right font-bold">Total</td>
                      <td className="px-2 py-1.5 text-right tnum font-bold text-primary">{inr(preview.total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Rejected lines */}
            {preview.rejected.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <XCircle size={16} className="text-danger" />
                  <span className="text-body-sm font-semibold text-danger">
                    {preview.rejected.length} line(s) rejected
                  </span>
                </div>
                <ul className="space-y-1">
                  {preview.rejected.map((r, i) => (
                    <li
                      key={i}
                      className="text-caption text-danger bg-danger-soft border border-danger/20 rounded px-3 py-1.5"
                    >
                      <span className="font-mono font-semibold">{r.sku}</span>
                      {" "}·{" "}
                      {r.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 text-danger text-body-sm bg-danger-soft border border-danger/30 rounded-md p-3">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Done */}
        {step === "done" && (
          <div className="flex-1 flex flex-col items-center justify-center px-5 py-8 gap-4">
            <CheckCircle2 size={48} className="text-success" />
            <div className="text-body font-semibold text-center">
              Return created and sent for approval
            </div>
            <div className="text-body-sm text-ink-muted text-center">
              The return is now in the Approvals inbox. Open it to approve or reject individual lines.
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-canvas rounded-b-xl flex-shrink-0">
          {step === "upload" && (
            <>
              <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" onClick={runPreview} disabled={busy || !file || !customerId}>
                {busy ? "Checking…" : "Preview"}
              </Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setStep("upload")} disabled={busy}>
                Back
              </Button>
              <Button size="sm" onClick={confirmImport} disabled={busy || (preview?.accepted.length ?? 0) === 0}>
                {busy ? "Creating…" : `Confirm & Create Return (${preview?.accepted.length ?? 0} lines)`}
              </Button>
            </>
          )}
          {step === "done" && (
            <Button size="sm" onClick={onClose}>Close</Button>
          )}
        </div>
      </div>
    </div>
  );
};
