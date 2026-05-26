// CreditNoteDetail — read-only overlay for a Credit Note document.
// Opened from ReturnDetail when the user clicks "View Credit Note".

import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import { Chip } from "@/components/common/Chip";
import { api, apiEnabled, type CreditNoteRow } from "@/lib/api";
import { inr } from "@/lib/format";

interface Props {
  creditNoteId: string;
  onClose: () => void;
}

export const CreditNoteDetail = ({ creditNoteId, onClose }: Props) => {
  const [cn, setCn] = useState<CreditNoteRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiEnabled) return;
    api
      .creditNote(creditNoteId)
      .then(setCn)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [creditNoteId]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-60 bg-black/30"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <aside className="fixed right-0 top-0 bottom-0 z-70 w-full max-w-lg bg-surface shadow-xl flex flex-col border-l border-border">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-canvas flex-shrink-0">
          <FileText size={18} className="text-success" />
          <div className="flex-1">
            <div className="font-semibold text-body-sm text-ink-strong flex items-center gap-2">
              {cn?.creditNoteNo ?? "Credit Note"}
              {cn && (
                <Chip tone={cn.status === "applied" ? "success" : "info"} size="sm" className="capitalize">
                  {cn.status}
                </Chip>
              )}
            </div>
            {cn && (
              <div className="text-caption text-ink-muted">
                {cn.customer.name} · {inr(cn.total)}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 grid place-items-center rounded text-ink-muted hover:bg-surface-hover"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-ink-muted text-body-sm">Loading…</div>
          ) : error ? (
            <div className="p-8 text-center text-danger text-body-sm">{error}</div>
          ) : cn ? (
            <div className="p-5 space-y-5">
              {/* Header info grid */}
              <div className="grid grid-cols-2 gap-3">
                <InfoBox label="Credit Note #" value={cn.creditNoteNo} />
                <InfoBox label="Customer" value={`${cn.customer.code} · ${cn.customer.name}`} />
                <InfoBox label="Issued" value={new Date(cn.createdAt).toLocaleDateString()} />
                {cn.invoice && (
                  <InfoBox label="Applied to Invoice" value={cn.invoice.invoiceNo} />
                )}
                <InfoBox label="Source Return" value={cn.customerReturn.returnNo} />
                {cn.customer.gst && (
                  <InfoBox label="Customer GSTIN" value={cn.customer.gst} />
                )}
              </div>

              {/* Line items */}
              <div>
                <div className="text-body-sm font-semibold mb-2">Credit lines</div>
                <table className="w-full text-caption border border-border rounded-md overflow-hidden">
                  <thead className="bg-canvas">
                    <tr>
                      <th className="text-left px-3 py-2 text-ink-muted">Item</th>
                      <th className="text-right px-3 py-2 text-ink-muted">Qty</th>
                      <th className="text-right px-3 py-2 text-ink-muted">Rate</th>
                      <th className="text-right px-3 py-2 text-ink-muted">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {cn.items.map((item) => (
                      <tr key={item.id} className="hover:bg-canvas">
                        <td className="px-3 py-2">
                          <div className="font-semibold">{item.product.name}</div>
                          <div className="font-mono text-ink-muted">
                            {item.variant?.sku ?? item.product.sku}
                          </div>
                          <div className="text-ink-muted capitalize mt-0.5">
                            {item.reason.replace(/_/g, " ")}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tnum">{item.qty}</td>
                        <td className="px-3 py-2 text-right tnum">{inr(item.rate)}</td>
                        <td className="px-3 py-2 text-right tnum font-semibold">{inr(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-canvas">
                    <tr>
                      <td colSpan={3} className="px-3 py-2 text-right text-ink-muted">Subtotal</td>
                      <td className="px-3 py-2 text-right tnum">{inr(cn.subTotal)}</td>
                    </tr>
                    <tr>
                      <td colSpan={3} className="px-3 py-2 text-right text-ink-muted">Tax (18%)</td>
                      <td className="px-3 py-2 text-right tnum">{inr(cn.tax)}</td>
                    </tr>
                    <tr>
                      <td colSpan={3} className="px-3 py-2 text-right font-bold">Total credit</td>
                      <td className="px-3 py-2 text-right tnum font-bold text-success">{inr(cn.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {cn.notes && (
                <div className="border border-border rounded-md px-4 py-3 bg-canvas">
                  <div className="text-caption text-ink-muted font-semibold uppercase tracking-wide mb-1">Notes</div>
                  <div className="text-body-sm text-ink">{cn.notes}</div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
};

const InfoBox = ({ label, value }: { label: string; value: string }) => (
  <div className="bg-canvas border border-border rounded-md p-3">
    <div className="text-caption text-ink-muted uppercase tracking-wide font-semibold">{label}</div>
    <div className="text-body-sm font-semibold text-ink mt-1">{value}</div>
  </div>
);
