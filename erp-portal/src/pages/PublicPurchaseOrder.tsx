// Public-facing Purchase Order viewer reached via
// /share/purchase-order/:token. Vendor-only - read-only, no auth.
// We render the vendor's "bill to" block in the customer slot of the
// PublicDocShell so the same shell does the heavy lifting.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type PublicPurchaseOrderPayload } from "@/lib/api";
import { inr } from "@/lib/format";
import { PublicDocShell, fmtPublicDate } from "@/components/public/PublicDocShell";

const statusBadge = (status: string) => {
  const s = status.toLowerCase();
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "Draft", cls: "bg-gray-100 text-gray-700 border-gray-300" },
    approved: { label: "Approved", cls: "bg-blue-50 text-blue-700 border-blue-300" },
    partial: { label: "Partially received", cls: "bg-amber-50 text-amber-700 border-amber-300" },
    received: { label: "Received", cls: "bg-green-50 text-green-700 border-green-300" },
    closed: { label: "Closed", cls: "bg-gray-100 text-gray-700 border-gray-300" },
    cancelled: { label: "Cancelled", cls: "bg-red-50 text-red-700 border-red-300" },
  };
  return map[s] ?? { label: status, cls: "bg-gray-100 text-gray-700 border-gray-300" };
};

export const PublicPurchaseOrder = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicPurchaseOrderPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const po = await api.publicPurchaseOrder(token);
        if (!cancelled) setData(po);
      } catch (e) {
        if (!cancelled) {
          const err = e as { status?: number; message?: string };
          setError(
            err.status === 404
              ? "This purchase order link is invalid, was revoked, or has expired."
              : err.message ?? "Failed to load purchase order"
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const badge = statusBadge(data?.status ?? "");

  // The "customer" block in PublicDocShell is repurposed as the
  // recipient block. For a PO that's the vendor we're issuing to.
  const recipient = data
    ? {
        name: data.vendor.name,
        gst: data.vendor.gst,
        city: data.vendor.city,
        contact: data.vendor.contact,
      }
    : { name: "" };

  const meta = data
    ? [
        { label: "PO date", value: fmtPublicDate(data.date) },
        { label: "Expected by", value: fmtPublicDate(data.expectedDate) },
        ...(data.vendor.paymentTerms
          ? [{ label: "Payment terms", value: data.vendor.paymentTerms }]
          : []),
      ]
    : [];

  return (
    <PublicDocShell
      docKindLabel="Purchase Order"
      docNo={data?.poNo ?? ""}
      statusLabel={badge.label}
      statusClass={badge.cls}
      bannerText="Purchase order · read-only"
      customer={recipient}
      meta={meta}
      footerNote={
        data
          ? "Please acknowledge receipt of this PO and confirm dispatch schedule. Goods to be supplied per the agreed terms."
          : undefined
      }
      loading={!data && !error}
      errorMessage={error}
    >
      {data && (
        <>
          {data.vendor.address && (
            <div className="pt-1 pb-2 text-sm text-gray-600 whitespace-pre-line">
              {data.vendor.address}
            </div>
          )}
          <div className="py-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-300">
                  <th className="py-2 pr-3 w-10">#</th>
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3 text-right w-24">Qty</th>
                  <th className="py-2 pr-3 text-right w-24">Rate</th>
                  <th className="py-2 text-right w-28">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it, i) => (
                  <tr key={i} className="border-b border-gray-100 align-top">
                    <td className="py-2.5 pr-3 text-gray-500 tabular-nums">{i + 1}</td>
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-gray-900">{it.productName}</div>
                      <div className="text-xs text-gray-400 mt-0.5 tabular-nums">
                        SKU {it.productSku}
                        {it.hsn && <span> · HSN {it.hsn}</span>}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {it.qty}{" "}
                      <span className="text-gray-400 text-xs">{it.uom}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{inr(it.rate)}</td>
                    <td className="py-2.5 text-right tabular-nums font-semibold">
                      {inr(it.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end pb-6 border-b border-gray-200">
            <div className="w-72 space-y-1.5 text-sm">
              <div className="flex justify-between text-lg pt-2 border-t border-gray-200 mt-1">
                <span className="font-bold">Total order value</span>
                <span className="font-bold tabular-nums">{inr(data.amount)}</span>
              </div>
              {data.receivedPct > 0 && (
                <div className="flex justify-between text-xs text-gray-500 pt-1">
                  <span>Received so far</span>
                  <span className="tabular-nums">{data.receivedPct}%</span>
                </div>
              )}
            </div>
          </div>

          {data.notes && (
            <div className="pt-6">
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">
                Notes
              </div>
              <div className="text-sm text-gray-700 whitespace-pre-line">{data.notes}</div>
            </div>
          )}
        </>
      )}
    </PublicDocShell>
  );
};
