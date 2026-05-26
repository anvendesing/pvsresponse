// BulkOrderExportModal
// Opens as an overlay dialog from the Inventory and Price Lists pages.
// Lets the user choose pricelist, optional customer, and whether to include
// out-of-stock items, then triggers a browser download of the .xlsx.

import { useState } from "react";
import { Download, FileSpreadsheet, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { api, downloadPriceListXlsx, type PriceListRow } from "@/lib/api";
import { useApi } from "@/hooks/useApi";

interface Props {
  /** Pre-select this pricelist (pass when opened from the Price Lists page row). */
  priceListId?: string;
  /** Pre-select this customer. */
  customerId?: string;
  onClose: () => void;
}

export const BulkOrderExportModal = ({ priceListId: initPlId, customerId: initCustId, onClose }: Props) => {
  const [selectedPl, setSelectedPl] = useState(initPlId ?? "");
  const [selectedCust, setSelectedCust] = useState(initCustId ?? "");
  const [includeOos, setIncludeOos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: priceLists } = useApi<PriceListRow[]>(() => api.priceLists(), []);
  const { data: customers } = useApi(() => api.customers(), []);

  const activePlists = (priceLists ?? []).filter((p) => p.active);

  const handleDownload = async () => {
    if (!selectedPl) {
      setError("Select a price list.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await downloadPriceListXlsx(selectedPl, {
        includeOutOfStock: includeOos,
        customerId: selectedCust || undefined,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message ?? "Download failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="relative bg-surface rounded-xl shadow-xl w-full max-w-md mx-4 p-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-canvas">
          <FileSpreadsheet size={20} className="text-primary" />
          <div className="flex-1">
            <div className="font-semibold text-body-sm text-ink-strong">Export Bulk Order Sheet</div>
            <div className="text-caption text-ink-muted">
              Generates an Excel file. Customer fills the QTY column and returns it for import.
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 grid place-items-center rounded text-ink-muted hover:bg-surface-hover"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Price list selector */}
          <div>
            <label className="block text-caption font-semibold text-ink-muted uppercase mb-1">
              Price list <span className="text-danger">*</span>
            </label>
            <select
              className="h-9 w-full bg-canvas border border-border rounded-md px-2 text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={selectedPl}
              onChange={(e) => setSelectedPl(e.target.value)}
            >
              <option value="">— Select price list —</option>
              {activePlists.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {pl.name} ({pl.code})
                </option>
              ))}
            </select>
          </div>

          {/* Customer (optional) */}
          <div>
            <label className="block text-caption font-semibold text-ink-muted uppercase mb-1">
              Customer <span className="text-ink-muted font-normal">(optional — pre-fills header)</span>
            </label>
            <select
              className="h-9 w-full bg-canvas border border-border rounded-md px-2 text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={selectedCust}
              onChange={(e) => setSelectedCust(e.target.value)}
            >
              <option value="">— No customer —</option>
              {(customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>

          {/* Include out of stock */}
          <label className="flex items-center gap-2 cursor-pointer select-none text-body-sm">
            <input
              type="checkbox"
              className="rounded"
              checked={includeOos}
              onChange={(e) => setIncludeOos(e.target.checked)}
            />
            Include out-of-stock SKUs
            <span className="text-ink-muted text-caption">(stock shown as 0)</span>
          </label>

          {error && (
            <div className="rounded-md bg-danger-soft border border-danger/30 px-3 py-2 text-body-sm text-danger">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-canvas">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            icon={<Download size={14} />}
            onClick={handleDownload}
            disabled={busy || !selectedPl}
          >
            {busy ? "Generating…" : "Download Excel"}
          </Button>
        </div>
      </div>
    </div>
  );
};
