// Public-facing packing-slip / dispatch note reached via /share/packing-slip/:token.
// Customers use this as the delivery note that ships with the goods.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type PublicPackingSlipPayload } from "@/lib/api";
import { PublicDocShell, fmtPublicDate } from "@/components/public/PublicDocShell";

const statusBadge = (status: string) => {
  const s = status.toLowerCase();
  const map: Record<string, { label: string; cls: string }> = {
    open: { label: "Open", cls: "bg-blue-50 text-blue-700 border-blue-300" },
    packed: { label: "Packed", cls: "bg-amber-50 text-amber-700 border-amber-300" },
    invoiced: { label: "Invoiced", cls: "bg-green-50 text-green-700 border-green-300" },
    cancelled: { label: "Cancelled", cls: "bg-red-50 text-red-700 border-red-300" },
  };
  return map[s] ?? { label: status, cls: "bg-gray-100 text-gray-700 border-gray-300" };
};

export const PublicPackingSlip = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicPackingSlipPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const ps = await api.publicPackingSlip(token);
        if (!cancelled) setData(ps);
      } catch (e) {
        if (!cancelled) {
          const err = e as { status?: number; message?: string };
          setError(
            err.status === 404
              ? "This packing slip link is invalid, was revoked, or has expired."
              : err.message ?? "Failed to load packing slip"
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const badge = statusBadge(data?.status ?? "");
  const totalUnits = data?.items.reduce((s, it) => s + it.qtyPacked, 0) ?? 0;
  const meta = data
    ? [
        ...(data.packedAt
          ? [{ label: "Packed", value: fmtPublicDate(data.packedAt) }]
          : [{ label: "Created", value: fmtPublicDate(data.createdAt) }]),
        { label: "SO ref", value: data.soNo },
        ...(data.invoiceNo
          ? [{ label: "Invoice", value: data.invoiceNo }]
          : []),
      ]
    : [];

  return (
    <PublicDocShell
      docKindLabel="Packing Slip"
      docNo={data?.packingSlipNo ?? ""}
      statusLabel={badge.label}
      statusClass={badge.cls}
      bannerText="Dispatch note · read-only"
      customer={data?.customer ?? { name: "" }}
      meta={meta}
      footerNote={
        data
          ? "Please verify quantities against this slip on receipt and report any discrepancy within 24 hours."
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
                  <th className="py-2 pr-3 text-right w-20">Picked</th>
                  <th className="py-2 text-right w-20">Packed</th>
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
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {it.qtyOrdered}{" "}
                      <span className="text-gray-400 text-xs">{it.uom}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{it.qtyPicked}</td>
                    <td className="py-2.5 text-right tabular-nums font-semibold">
                      {it.qtyPacked}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end pb-6 border-b border-gray-200">
            <div className="w-72 space-y-1.5 text-sm">
              <div className="flex justify-between text-base">
                <span className="font-bold">Total units packed</span>
                <span className="font-bold tabular-nums">{totalUnits}</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Quantities reflect the physical pack — invoice values are
                computed on these.
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
