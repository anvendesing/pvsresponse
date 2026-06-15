// Authenticated, print-friendly view of a Packing Slip / dispatch note.
// Mirrors the public /share/packing-slip/:token layout but uses the
// authenticated API so the operator doesn't have to mint a share token
// just to print. Auto-fires the print dialog on load.

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { api, type PackingSlipRow, type PublicCompany } from "@/lib/api";
import { useBrand } from "@/hooks/useBrand";
import { primaryScanCode } from "@/lib/scanCode";

const fmt = (d?: string | Date | null) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const variantAttrs = (
  v: { size?: string | null; color?: string | null; grade?: string | null } | null | undefined
): string =>
  [v?.size, v?.color, v?.grade].filter(Boolean).join(" / ");

export const PrintPackingSlip = () => {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const [ps, setPs] = useState<PackingSlipRow | null>(null);
  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { brandName } = useBrand();

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const [slip, comp] = await Promise.all([
          api.packingSlip(id),
          api.publicCompany().catch(() => null),
        ]);
        if (!cancelled) {
          setPs(slip);
          setCompany(comp);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (params.get("print") !== "0" && ps) {
      const t = window.setTimeout(() => window.print(), 350);
      return () => window.clearTimeout(t);
    }
  }, [params, ps]);

  if (error) {
    return (
      <div className="min-h-screen grid place-items-center p-6 bg-white text-red-700">
        Failed to load packing slip: {error}
      </div>
    );
  }
  if (!ps) {
    return (
      <div className="min-h-screen grid place-items-center bg-white text-gray-500">
        Loading packing slip…
      </div>
    );
  }

  const totalOrdered = ps.items.reduce((s, i) => s + i.qtyOrdered, 0);
  const totalPicked = ps.items.reduce((s, i) => s + i.qtyPicked, 0);
  const totalPacked = ps.items.reduce((s, i) => s + i.qtyPacked, 0);
  const variance = totalPacked - totalPicked;

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="print:hidden bg-white border-b shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            Dispatch note · ships with the goods
          </div>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-md inline-flex items-center gap-2"
          >
            <Printer size={14} /> Print / Save as PDF
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 print:p-0 print:max-w-none">
        <div className="bg-white rounded-lg shadow-sm print:shadow-none print:rounded-none p-8 md:p-10 print:p-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-6 pb-6 border-b border-gray-300">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {company?.tradeName || company?.legalName || brandName}
              </h1>
              {company?.addressLine && (
                <div className="text-sm text-gray-600 mt-1 whitespace-pre-line">
                  {[company.addressLine, [company.city, company.state, company.pincode].filter(Boolean).join(", ")].filter(Boolean).join("\n")}
                </div>
              )}
              {company?.gstin && (
                <div className="text-xs text-gray-500 mt-2">
                  GSTIN: <strong>{company.gstin}</strong>
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                Packing Slip
              </div>
              <div className="text-2xl font-bold text-gray-900 mt-0.5">
                {ps.packingSlipNo}
              </div>
              <div className="text-xs text-gray-500 mt-1 capitalize">
                Status · <strong>{ps.status}</strong>
              </div>
              {ps.awb && (
                <div className="text-xs text-gray-500 mt-1">
                  AWB <strong className="font-mono">{ps.awb}</strong>
                  {ps.carrier && <span className="ml-1">({ps.carrier})</span>}
                </div>
              )}
            </div>
          </div>

          {/* Customer + meta */}
          <div className="grid grid-cols-2 gap-6 py-5 border-b border-gray-200">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                Ship to
              </div>
              <div className="text-base font-bold text-gray-900 mt-1">
                {ps.salesOrder?.customer?.name ?? "—"}
              </div>
              {ps.salesOrder?.customer?.city && (
                <div className="text-sm text-gray-600">
                  {ps.salesOrder.customer.city}
                </div>
              )}
              {ps.salesOrder?.customer?.contact && (
                <div className="text-xs text-gray-500 mt-1">
                  {ps.salesOrder.customer.contact}
                </div>
              )}
            </div>
            <div className="text-right space-y-1 text-sm">
              <div>
                <span className="text-gray-500">SO ref: </span>
                <strong>{ps.salesOrder?.soNo ?? "—"}</strong>
              </div>
              {ps.pickList && (
                <div>
                  <span className="text-gray-500">Pick list: </span>
                  <strong>{ps.pickList.pickListNo}</strong>
                </div>
              )}
              <div>
                <span className="text-gray-500">Created: </span>
                <strong>{fmt(ps.createdAt)}</strong>
              </div>
              {ps.packedAt && (
                <div>
                  <span className="text-gray-500">Packed: </span>
                  <strong>{fmt(ps.packedAt)}</strong>
                </div>
              )}
              {ps.assignedTo && (
                <div>
                  <span className="text-gray-500">Packer: </span>
                  <strong>{ps.assignedTo.name}</strong>
                </div>
              )}
            </div>
          </div>

          {/* Lines */}
          <div className="py-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-300">
                  <th className="py-2 pr-2 w-8">#</th>
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-2 text-right w-16">Ord</th>
                  <th className="py-2 pr-2 text-right w-16">Picked</th>
                  <th className="py-2 text-right w-16">Packed</th>
                </tr>
              </thead>
              <tbody>
                {ps.items.map((it, i) => {
                  const lineVar = it.qtyPacked - it.qtyPicked;
                  return (
                    <tr
                      key={it.id}
                      className="border-b border-gray-100 align-top print:break-inside-avoid"
                    >
                      <td className="py-2 pr-2 text-gray-500 tabular-nums">
                        {i + 1}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-medium text-gray-900">
                          {it.product?.name}
                        </div>
                        <div className="text-xs text-gray-500 font-mono">
                          {it.variant
                            ? primaryScanCode(it.variant)
                            : primaryScanCode(it.product ?? { sku: "—", barcode: null })}
                          {variantAttrs(it.variant) && (
                            <span> · {variantAttrs(it.variant)}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums text-gray-600">
                        {it.qtyOrdered}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {it.qtyPicked}
                      </td>
                      <td
                        className={`py-2 text-right tabular-nums font-semibold ${
                          lineVar !== 0 ? "text-amber-700" : ""
                        }`}
                      >
                        {it.qtyPacked}
                        {lineVar !== 0 && (
                          <span className="ml-1 text-xs">
                            ({lineVar > 0 ? "+" : ""}
                            {lineVar})
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-400 font-semibold">
                  <td colSpan={2} className="py-2 pr-2 text-right text-gray-700">
                    Totals
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {totalOrdered}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {totalPicked}
                  </td>
                  <td className="py-2 text-right tabular-nums">{totalPacked}</td>
                </tr>
              </tfoot>
            </table>
            {variance !== 0 && (
              <div className="mt-3 text-xs text-amber-700">
                <strong>Variance · {variance > 0 ? "+" : ""}{variance}</strong>{" "}
                · packed differs from picked. Stock-impact happens at invoice.
              </div>
            )}
          </div>

          {ps.notes && (
            <div className="pt-4 border-t border-gray-200">
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">
                Notes
              </div>
              <div className="text-sm text-gray-700 whitespace-pre-line">
                {ps.notes}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-12 pt-12 mt-12 border-t border-gray-300">
            <SignatureBlock label="Packed by" />
            <SignatureBlock label="Received by" />
          </div>

          <div className="mt-6 text-center text-xs text-gray-400">
            Generated {fmt(new Date())} · {brandName} dispatch note
          </div>
        </div>
      </div>
    </div>
  );
};

const SignatureBlock = ({ label }: { label: string }) => (
  <div>
    <div className="border-b border-gray-400 h-12 mb-1" />
    <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold">
      {label}
    </div>
    <div className="text-xs text-gray-400 mt-0.5">Name · Date · Signature</div>
  </div>
);
