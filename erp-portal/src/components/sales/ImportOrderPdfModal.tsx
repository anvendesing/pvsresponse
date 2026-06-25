// Import-order PDF modal — operator flow:
//
//   1. Pick channel (defaults to DTDC) and drop / pick the PDF.
//   2. Hit "Parse" → backend extracts customer + items, resolves each
//      external item code against ChannelMapping, returns a preview.
//   3. The operator reviews:
//        * customer block (may match an existing Customer by phone)
//        * shipping refs (AWB, courier, external order #)
//        * line items — each line shows status (mapped / no_map / no_sku)
//          and lets the operator override the internal SKU inline.
//   4. "Create order" calls /imported-orders/commit. The new SO opens
//      in the detail drawer; picking / packing proceeds as normal.
//      The first invoice will use the IMP-INV-2026-XXXX series.

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Truck,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import {
  api,
  type ImportedOrderPreview,
  type ImportedOrderCommitBody,
} from "@/lib/api";
import { inr } from "@/lib/format";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (soId: string, soNo: string) => void;
}

// Mutable per-item override. The operator can edit qty, rate, and the
// internal SKU mapping inline before committing.
type DraftItem = ImportedOrderPreview["items"][number] & {
  // Tracks operator-side override for internalSku so we can re-resolve
  // by calling the preview again if needed. For now we just send the
  // edited values to /commit.
  draftQty: number;
  draftRate: number;
  draftSku: string;
};

export const ImportOrderPdfModal = ({ open, onClose, onCreated }: Props) => {
  const [channel, setChannel] = useState("DTDC");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportedOrderPreview | null>(null);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [customer, setCustomer] = useState<
    ImportedOrderPreview["parsed"]["customer"] | null
  >(null);
  const [forceReimport, setForceReimport] = useState(false);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setPreview(null);
      setDraftItems([]);
      setCustomer(null);
      setError(null);
      setBusy(false);
      setForceReimport(false);
    }
  }, [open]);

  const onParse = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api.previewImportedOrder(file, channel || "DTDC");
      setPreview(p);
      setCustomer(p.parsed.customer);
      setDraftItems(
        p.items.map((it) => ({
          ...it,
          draftQty: it.qty,
          draftRate: it.rate,
          draftSku: it.internalSku ?? "",
        }))
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const okCount = useMemo(
    () => draftItems.filter((d) => d.status === "ok").length,
    [draftItems]
  );
  const blockedCount = useMemo(
    () => draftItems.filter((d) => d.status !== "ok").length,
    [draftItems]
  );

  const onCommit = async () => {
    if (!preview || !customer) return;
    // Block items that have no resolved product unless the operator
    // skips them (handled by removing the row before commit). For
    // simplicity we just block commit if any line is still unresolved.
    if (blockedCount > 0) {
      setError(
        `Resolve ${blockedCount} unmapped line${blockedCount === 1 ? "" : "s"} in Settings → Channel mappings, then re-parse.`
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: ImportedOrderCommitBody = {
        channel: preview.channel,
        customer: {
          customerId: preview.customerMatch?.id ?? null,
          externalCode: customer.externalCode,
          name: customer.name ?? "Imported customer",
          addressLine: customer.addressLine,
          landmark: customer.landmark,
          city: customer.city,
          pincode: customer.pincode,
          phone: customer.phone,
        },
        shipping: preview.parsed.shipping,
        invoice: preview.parsed.invoice,
        items: draftItems
          .filter((d) => d.status === "ok" && d.productId)
          .map((d) => ({
            externalCode: d.externalCode,
            description: d.description,
            internalSku: d.draftSku,
            productId: d.productId!,
            variantId: d.variantId,
            qty: Number(d.draftQty) || 0,
            rate: Number(d.draftRate) || 0,
          })),
        forceReimport,
      };
      const so = (await api.commitImportedOrder(body)) as { id: string; soNo: string };
      onCreated(so.id, so.soNo);
      onClose();
    } catch (e) {
      const err = e as { status?: number; details?: { existingSoNo?: string } };
      if (err.status === 409 && err.details?.existingSoNo) {
        setError(
          `This order was already imported as ${err.details.existingSoNo}. Tick "Force re-import" to create another.`
        );
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-lg shadow-xl w-full max-w-5xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Truck size={18} className="text-primary" />
            <h3 className="text-body font-semibold">Import shipping-label order PDF</h3>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {error && (
            <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-caption text-danger flex items-center gap-2">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          {/* Step 1: file selection */}
          <div className="border border-border rounded-md p-3 bg-canvas/30 space-y-3">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="w-32">
                <label className="text-caption text-ink-muted">Channel</label>
                <Input value={channel} onChange={(e) => setChannel(e.target.value)} />
              </div>
              <div className="flex-1 min-w-[260px]">
                <label className="text-caption text-ink-muted">Order PDF</label>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setPreview(null);
                  }}
                  className="block w-full text-caption mt-1"
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                icon={<Upload size={14} />}
                onClick={onParse}
                disabled={!file || busy}
              >
                {busy && !preview ? "Parsing…" : preview ? "Re-parse" : "Parse PDF"}
              </Button>
            </div>
            {file && (
              <div className="text-caption text-ink-muted flex items-center gap-2">
                <FileText size={12} />
                {file.name} · {(file.size / 1024).toFixed(1)} KB
              </div>
            )}
          </div>

          {preview && customer && (
            <>
              {/* Existing SO warning */}
              {preview.existingSo && (
                <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-caption text-warning flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2">
                    <AlertCircle size={14} />
                    External order{" "}
                    <code>{preview.parsed.shipping.externalOrderNo}</code> already
                    imported as <b>{preview.existingSo.soNo}</b> (
                    {preview.existingSo.status}).
                  </span>
                  <label className="flex items-center gap-1 text-caption">
                    <input
                      type="checkbox"
                      checked={forceReimport}
                      onChange={(e) => setForceReimport(e.target.checked)}
                    />
                    Force re-import
                  </label>
                </div>
              )}

              {/* Counts */}
              <div className="flex items-center gap-2">
                <Chip tone="success" icon={<CheckCircle2 size={12} />}>
                  {okCount} mapped
                </Chip>
                {preview.counts.noMap > 0 && (
                  <Chip tone="warning" icon={<AlertCircle size={12} />}>
                    {preview.counts.noMap} no mapping
                  </Chip>
                )}
                {preview.counts.noSku > 0 && (
                  <Chip tone="danger" icon={<AlertCircle size={12} />}>
                    {preview.counts.noSku} mapped SKU not in catalog
                  </Chip>
                )}
              </div>

              {/* Customer + shipping */}
              <div className="grid grid-cols-2 gap-3">
                <div className="border border-border rounded-md p-3">
                  <div className="text-caption font-semibold text-ink-muted mb-2">
                    Ship to
                    {preview.customerMatch && (
                      <Chip tone="success" size="sm" className="ml-2">
                        Existing · {preview.customerMatch.code}
                      </Chip>
                    )}
                    {!preview.customerMatch && (
                      <Chip tone="warning" size="sm" className="ml-2">
                        New customer will be created
                      </Chip>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-caption">
                    <Field
                      label="Name"
                      value={customer.name ?? ""}
                      onChange={(v) => setCustomer({ ...customer, name: v })}
                    />
                    <Field
                      label="Phone"
                      value={customer.phone ?? ""}
                      onChange={(v) => setCustomer({ ...customer, phone: v })}
                    />
                    <Field
                      label="Address"
                      value={customer.addressLine ?? ""}
                      onChange={(v) => setCustomer({ ...customer, addressLine: v })}
                      span={2}
                    />
                    <Field
                      label="Landmark"
                      value={customer.landmark ?? ""}
                      onChange={(v) => setCustomer({ ...customer, landmark: v })}
                      span={2}
                    />
                    <Field
                      label="City"
                      value={customer.city ?? ""}
                      onChange={(v) => setCustomer({ ...customer, city: v })}
                    />
                    <Field
                      label="Pincode"
                      value={customer.pincode ?? ""}
                      onChange={(v) => setCustomer({ ...customer, pincode: v })}
                    />
                  </div>
                </div>

                <div className="border border-border rounded-md p-3">
                  <div className="text-caption font-semibold text-ink-muted mb-2">
                    Shipping / invoice refs
                  </div>
                  <div className="text-caption space-y-1">
                    <KV k="External order #" v={preview.parsed.shipping.externalOrderNo} />
                    <KV k="AWB #" v={preview.parsed.shipping.awb} />
                    <KV k="Courier" v={preview.parsed.shipping.courier} />
                    <KV k="External invoice #" v={preview.parsed.invoice.externalInvoiceNo} />
                    <KV k="External invoice date" v={preview.parsed.invoice.invoiceDate} />
                    <KV
                      k="PDF totals"
                      v={
                        preview.parsed.totals.totalUnits
                          ? `${preview.parsed.totals.totalUnits} units · ${inr(preview.parsed.totals.grandTotal ?? 0)}`
                          : null
                      }
                    />
                  </div>
                  <div className="mt-3 text-caption text-ink-muted">
                    First invoice issued for this order will use the{" "}
                    <code className="bg-canvas px-1">IMP-INV-2026-XXXX</code> series.
                  </div>
                </div>
              </div>

              {/* Items */}
              <div className="border border-border rounded-md overflow-hidden">
                <div className="px-3 py-2 bg-canvas/50 text-caption font-semibold">
                  Line items ({draftItems.length})
                </div>
                <div className="max-h-96 overflow-auto">
                  <table className="w-full text-body-sm">
                    <thead className="bg-canvas text-caption text-ink-muted sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium w-24">External</th>
                        <th className="text-left px-3 py-2 font-medium">Description (from PDF)</th>
                        <th className="text-left px-3 py-2 font-medium w-32">SKU / barcode</th>
                        <th className="text-left px-3 py-2 font-medium">Product</th>
                        <th className="text-right px-3 py-2 font-medium w-20">Qty</th>
                        <th className="text-right px-3 py-2 font-medium w-24">Rate (₹)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draftItems.map((d, idx) => {
                        const tone =
                          d.status === "ok"
                            ? "border-l-success"
                            : d.status === "no_map"
                              ? "border-l-warning"
                              : "border-l-danger";
                        return (
                          <tr
                            key={`${d.externalCode}-${idx}`}
                            className={`border-t border-border border-l-2 ${tone}`}
                          >
                            <td className="px-3 py-1.5 font-mono text-caption">
                              {d.externalCode}
                            </td>
                            <td className="px-3 py-1.5 text-caption truncate max-w-xs">
                              {d.description}
                            </td>
                            <td className="px-3 py-1.5">
                              <Input
                                value={d.draftSku}
                                onChange={(e) => {
                                  const next = [...draftItems];
                                  next[idx] = { ...d, draftSku: e.target.value };
                                  setDraftItems(next);
                                }}
                                placeholder={d.status === "no_map" ? "Add mapping first" : ""}
                                className="font-mono text-caption"
                              />
                            </td>
                            <td className="px-3 py-1.5 text-caption">
                              {d.productName ? (
                                <span className="text-success inline-flex items-center gap-1">
                                  <CheckCircle2 size={12} />
                                  {d.productName}
                                </span>
                              ) : d.status === "no_map" ? (
                                <span className="text-warning inline-flex items-center gap-1">
                                  <AlertCircle size={12} />
                                  No mapping for {d.externalCode}
                                </span>
                              ) : (
                                <span className="text-danger inline-flex items-center gap-1">
                                  <AlertCircle size={12} />
                                  SKU {d.draftSku || "—"} not in catalog
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <Input
                                type="number"
                                value={d.draftQty}
                                onChange={(e) => {
                                  const next = [...draftItems];
                                  next[idx] = { ...d, draftQty: parseFloat(e.target.value) || 0 };
                                  setDraftItems(next);
                                }}
                                className="text-right tnum"
                              />
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <Input
                                type="number"
                                value={d.draftRate}
                                onChange={(e) => {
                                  const next = [...draftItems];
                                  next[idx] = { ...d, draftRate: parseFloat(e.target.value) || 0 };
                                  setDraftItems(next);
                                }}
                                className="text-right tnum"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {preview.parsed.unparsedItemLines.length > 0 && (
                  <div className="px-3 py-2 bg-warning/10 border-t border-warning/30 text-caption text-warning">
                    <AlertCircle size={12} className="inline mr-1" />
                    {preview.parsed.unparsedItemLines.length} lines could not be parsed
                    automatically. Add them manually below if needed.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
          <div className="text-caption text-ink-muted">
            {preview
              ? `Ready to create SO with ${okCount} line${okCount === 1 ? "" : "s"}.${blockedCount > 0 ? ` ${blockedCount} blocked.` : ""}`
              : "Upload a PDF to begin."}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={onCommit}
              disabled={!preview || busy || okCount === 0 || blockedCount > 0}
            >
              {busy && preview ? (
                <>
                  <Loader2 size={14} className="animate-spin mr-1" />
                  Creating…
                </>
              ) : (
                "Create sales order"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Field = ({
  label,
  value,
  onChange,
  span,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  span?: number;
}) => (
  <div className={span === 2 ? "col-span-2" : ""}>
    <div className="text-[10px] uppercase tracking-wider text-ink-muted">{label}</div>
    <Input value={value} onChange={(e) => onChange(e.target.value)} />
  </div>
);

const KV = ({ k, v }: { k: string; v: string | number | null }) => (
  <div className="flex items-baseline gap-2">
    <span className="text-ink-muted w-36 shrink-0">{k}</span>
    <span className="font-mono text-caption">{v ?? "—"}</span>
  </div>
);
