// Public-facing Sales Order acknowledgement reached via /share/sales-order/:token.
// Useful as an order confirmation that the customer can keep on file.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type PublicSalesOrderPayload } from "@/lib/api";
import { inr } from "@/lib/format";
import { resolveBillingTotals } from "@/lib/billingTotals";
import { PublicDocShell, fmtPublicDate } from "@/components/public/PublicDocShell";

const statusBadge = (status: string) => {
  const s = status.toLowerCase();
  const map: Record<string, { label: string; cls: string }> = {
    confirmed: { label: "Confirmed", cls: "bg-blue-50 text-blue-700 border-blue-300" },
    partially_invoiced: {
      label: "Partially invoiced",
      cls: "bg-amber-50 text-amber-700 border-amber-300",
    },
    invoiced: { label: "Invoiced", cls: "bg-green-50 text-green-700 border-green-300" },
    closed: { label: "Closed", cls: "bg-gray-100 text-gray-700 border-gray-300" },
    cancelled: { label: "Cancelled", cls: "bg-red-50 text-red-700 border-red-300" },
    on_hold: { label: "On hold", cls: "bg-orange-50 text-orange-700 border-orange-300" },
  };
  return map[s] ?? { label: status, cls: "bg-gray-100 text-gray-700 border-gray-300" };
};

export const PublicSalesOrder = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicSalesOrderPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const so = await api.publicSalesOrder(token);
        if (!cancelled) setData(so);
      } catch (e) {
        if (!cancelled) {
          const err = e as { status?: number; message?: string };
          setError(
            err.status === 404
              ? "This order link is invalid, was revoked, or has expired."
              : err.message ?? "Failed to load order"
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const billingTotals = data
    ? resolveBillingTotals({
        subTotal: data.subTotal,
        tax: data.tax,
        transportCharge: data.transportCharge,
        transportTax: data.transportTax,
        total: data.total,
      })
    : null;

  const badge = statusBadge(data?.status ?? "");
  const meta = data
    ? [
        { label: "Order date", value: fmtPublicDate(data.orderDate) },
        ...(data.quoteNo
          ? [{ label: "Quote ref", value: data.quoteNo as string }]
          : []),
      ]
    : [];

  return (
    <PublicDocShell
      docKindLabel="Sales Order"
      docNo={data?.soNo ?? ""}
      statusLabel={badge.label}
      statusClass={badge.cls}
      bannerText="Order confirmation · read-only"
      customer={data?.customer ?? { name: "" }}
      meta={meta}
      footerNote={
        data
          ? "Goods will be dispatched per the agreed schedule. Please contact us with any changes."
          : undefined
      }
      loading={!data && !error}
      errorMessage={error}
    >
      {data && (
        <>
          <div className="py-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-300">
                  <th className="py-2 pr-3 w-10">#</th>
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3 text-right w-20">Ordered</th>
                  <th className="py-2 pr-3 text-right w-20">Invoiced</th>
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
                      {it.variantAttrs && (
                        <div className="text-xs text-gray-500 mt-0.5">{it.variantAttrs}</div>
                      )}
                      <div className="text-xs text-gray-400 mt-0.5 tabular-nums">
                        SKU {it.variantSku ?? it.productSku}
                        {it.hsn && <span> · HSN {it.hsn}</span>}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {it.qtyOrdered}{" "}
                      <span className="text-gray-400 text-xs">{it.uom}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {it.qtyInvoiced}
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
              <div className="flex justify-between">
                <span className="text-gray-600">Sub-total (goods)</span>
                <span className="tabular-nums">{inr(billingTotals!.goodsSubTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">GST (goods)</span>
                <span className="tabular-nums">{inr(billingTotals!.goodsTax)}</span>
              </div>
              {(billingTotals!.transportCharge > 0 || billingTotals!.transportTax > 0) && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Freight / transport</span>
                    <span className="tabular-nums">{inr(billingTotals!.transportCharge)}</span>
                  </div>
                  {billingTotals!.transportTax > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">GST on freight</span>
                      <span className="tabular-nums">{inr(billingTotals!.transportTax)}</span>
                    </div>
                  )}
                </>
              )}
              <div className="flex justify-between text-lg pt-2 border-t border-gray-200 mt-1">
                <span className="font-bold">Order value</span>
                <span className="font-bold tabular-nums">{inr(billingTotals!.grandTotal)}</span>
              </div>
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
