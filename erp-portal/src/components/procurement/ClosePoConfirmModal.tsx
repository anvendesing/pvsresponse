import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import type { PoClosePreview } from "@/data/types";
import { api } from "@/lib/api";
import { num } from "@/lib/format";

interface Props {
  poId: string;
  poNo: string;
  onCancel: () => void;
  onClosed: () => void;
}

export const ClosePoConfirmModal = ({ poId, poNo, onCancel, onClosed }: Props) => {
  const [preview, setPreview] = useState<PoClosePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    void api
      .purchaseOrderClosePreview(poId)
      .then(setPreview)
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [poId]);

  const confirm = async () => {
    setClosing(true);
    setError(null);
    try {
      await api.closePurchaseOrder(poId);
      onClosed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setClosing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 grid place-items-center p-4"
      onClick={() => !closing && onCancel()}
    >
      <div
        className="bg-surface w-full max-w-lg rounded-lg elevation-3 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-warning-soft text-warning grid place-items-center shrink-0">
            <AlertTriangle size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-h3 font-bold">Close purchase order?</div>
            <div className="text-body-sm text-ink-muted mt-0.5 font-mono">{poNo}</div>
          </div>
          <button
            type="button"
            className="text-ink-muted hover:text-ink"
            onClick={onCancel}
            disabled={closing}
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[50vh] overflow-auto">
          {loading && (
            <p className="text-body-sm text-ink-muted animate-pulse">Loading unreceived lines…</p>
          )}
          {error && (
            <div className="text-danger text-body-sm bg-danger-soft border border-danger rounded px-3 py-2">
              {error}
            </div>
          )}
          {preview && (
            <>
              <p className="text-body-sm text-ink">
                Closing freezes this PO — no further GRNs can be posted against it.
              </p>
              {preview.dropsFromSupplyOutlook > 0 ? (
                <>
                  <div className="bg-warning-soft border border-warning rounded-md px-3 py-2 text-body-sm text-ink">
                    <strong>{num(preview.dropsFromSupplyOutlook)}</strong> units still unreceived
                    will <strong>no longer count as “expected”</strong> on the Products page.
                    Stock rules may create a new PO if supply outlook falls below the minimum.
                  </div>
                  <table className="w-full text-body-sm border border-border rounded overflow-hidden">
                    <thead className="bg-canvas text-caption text-ink-muted uppercase">
                      <tr>
                        <th className="px-2 py-1.5 text-left">Product</th>
                        <th className="px-2 py-1.5 text-right">Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.lines.map((l) => (
                        <tr key={l.productId} className="border-t border-border">
                          <td className="px-2 py-1.5">
                            <span className="font-mono text-caption">{l.sku}</span>
                            <div className="text-caption text-ink-muted truncate">{l.name}</div>
                          </td>
                          <td className="px-2 py-1.5 text-right tnum font-semibold">
                            {num(l.remaining)} {l.uom}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <p className="text-body-sm text-ink-muted">
                  All lines are fully received — closing will not change supply outlook.
                </p>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex justify-end gap-2 bg-canvas">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={closing}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={confirm}
            disabled={closing || loading}
          >
            {closing ? "Closing…" : "Close PO"}
          </Button>
        </div>
      </div>
    </div>
  );
};
