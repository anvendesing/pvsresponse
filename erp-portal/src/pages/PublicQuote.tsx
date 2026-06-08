// Public-facing quote viewer reached via /share/quote/:token.
//
// - No authentication required - the share token in the URL acts as
//   a capability. Anyone with the link can read the quote.
// - Layout is print-friendly: clean A4 single-column with a "Print"
//   button. If the URL contains ?print=1 the print dialog opens
//   automatically once the data is loaded (used by the "Print / Save as
//   PDF" share action in the back-office).
// - No internal IDs, internal user names, or back-office actions are
//   exposed.

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  api,
  type PublicCompany,
  type PublicQuotePayload,
} from "@/lib/api";
import { inr } from "@/lib/format";

const fmtDate = (d: string | Date) => {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

// Stitch the address fields the user entered in Settings into a single
// human-readable block. The order matches Indian invoice conventions.
const formatCompanyAddress = (c: PublicCompany | null): string => {
  if (!c) return "";
  const parts: string[] = [];
  if (c.addressLine) parts.push(c.addressLine);
  const cityLine = [c.city, c.state, c.pincode].filter(Boolean).join(", ");
  if (cityLine) parts.push(cityLine);
  if (c.country && c.country.toLowerCase() !== "india") parts.push(c.country);
  return parts.join("\n");
};

export const PublicQuote = () => {
  const { token } = useParams<{ token: string }>();
  const [params] = useSearchParams();
  const [data, setData] = useState<PublicQuotePayload | null>(null);
  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        // Load quote and company in parallel; the company endpoint is
        // public too so neither call needs an auth token.
        const [q, c] = await Promise.all([
          api.publicQuote(token),
          api.publicCompany().catch(() => null),
        ]);
        if (cancelled) return;
        setData(q);
        setCompany(c);
      } catch (e) {
        if (!cancelled) {
          const err = e as { status?: number; message?: string };
          setError(
            err.status === 404
              ? "This quote link is invalid, was revoked, or has expired."
              : err.message ?? "Failed to load quote"
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // ?print=1 auto-triggers the print dialog once the page is rendered.
  useEffect(() => {
    if (params.get("print") === "1" && data) {
      const t = window.setTimeout(() => window.print(), 300);
      return () => window.clearTimeout(t);
    }
  }, [params, data]);

  const totals = useMemo(() => {
    if (!data) return null;
    const lineTotal = data.items.reduce((s, l) => s + l.amount, 0);
    return {
      lineTotal,
      tax: data.tax,
      grand: data.total,
    };
  }, [data]);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 grid place-items-center p-6">
        <div className="max-w-md w-full bg-white rounded-lg shadow p-8 text-center">
          <div className="text-5xl mb-3">⚠</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Quote unavailable</h1>
          <p className="text-sm text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-100 grid place-items-center text-gray-500">
        Loading quote…
      </div>
    );
  }

  const statusBadge = (() => {
    const s = data.status.toLowerCase();
    const map: Record<string, { label: string; cls: string }> = {
      draft: { label: "Draft", cls: "bg-gray-100 text-gray-700 border-gray-300" },
      submitted: { label: "Submitted", cls: "bg-blue-50 text-blue-700 border-blue-300" },
      accepted: { label: "Accepted", cls: "bg-green-50 text-green-700 border-green-300" },
      rejected: { label: "Rejected", cls: "bg-red-50 text-red-700 border-red-300" },
      expired: { label: "Expired", cls: "bg-orange-50 text-orange-700 border-orange-300" },
      converted: { label: "Converted to SO", cls: "bg-purple-50 text-purple-700 border-purple-300" },
    };
    return map[s] ?? { label: data.status, cls: "bg-gray-100 text-gray-700 border-gray-300" };
  })();

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Top action bar (hidden on print) */}
      <div className="print:hidden bg-white border-b shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            Quote shared with you · read-only
          </div>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-md"
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      {/* Document body */}
      <div className="max-w-4xl mx-auto px-6 py-8 print:p-0 print:max-w-none">
        <div className="bg-white rounded-lg shadow-sm print:shadow-none print:rounded-none p-8 md:p-10 print:p-6">
          {/* Header: company + quote number */}
          <div className="flex items-start justify-between gap-6 pb-6 border-b border-gray-200">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {company?.tradeName || company?.legalName || "Your Company"}
              </h1>
              {company?.tradeName && company.legalName && (
                <div className="text-xs text-gray-500 mt-0.5">
                  {company.legalName}
                </div>
              )}
              {company && formatCompanyAddress(company) && (
                <div className="text-sm text-gray-600 mt-1 whitespace-pre-line">
                  {formatCompanyAddress(company)}
                </div>
              )}
              <div className="text-xs text-gray-500 mt-2 space-x-3">
                {company?.gstin && (
                  <span>
                    GSTIN: <strong>{company.gstin}</strong>
                  </span>
                )}
                {company?.phone && <span>Tel: {company.phone}</span>}
                {company?.email && <span>{company.email}</span>}
                {company?.website && <span>{company.website}</span>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                Quotation
              </div>
              <div className="text-xl font-bold text-gray-900 mt-0.5">
                {data.quoteNo}
              </div>
              <div className="text-xs text-gray-500">Revision {data.revision}</div>
              <span
                className={`inline-block mt-2 px-2.5 py-0.5 text-xs font-semibold rounded-full border ${statusBadge.cls}`}
              >
                {statusBadge.label}
              </span>
            </div>
          </div>

          {/* Customer + meta */}
          <div className="grid grid-cols-2 gap-6 py-6 border-b border-gray-200">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                Bill to
              </div>
              <div className="text-base font-bold text-gray-900 mt-1">
                {data.customer.name}
              </div>
              {data.customer.city && (
                <div className="text-sm text-gray-600">{data.customer.city}</div>
              )}
              {data.customer.gst && (
                <div className="text-xs text-gray-500 mt-1">
                  GSTIN: <strong>{data.customer.gst}</strong>
                </div>
              )}
              {data.customer.contact && (
                <div className="text-xs text-gray-500">{data.customer.contact}</div>
              )}
            </div>
            <div className="text-right space-y-1">
              <div className="text-sm">
                <span className="text-gray-500">Issued: </span>
                <strong>{fmtDate(data.createdAt)}</strong>
              </div>
              <div className="text-sm">
                <span className="text-gray-500">Valid until: </span>
                <strong>{fmtDate(data.validUntil)}</strong>
              </div>
              {data.paymentTerms && (
                <div className="text-sm">
                  <span className="text-gray-500">Payment terms: </span>
                  <strong>{data.paymentTerms}</strong>
                </div>
              )}
            </div>
          </div>

          {/* Line items */}
          <div className="py-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-300">
                  <th className="py-2 pr-3 w-10">#</th>
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3 text-right w-20">Qty</th>
                  <th className="py-2 pr-3 text-right w-24">Rate</th>
                  <th className="py-2 pr-3 text-right w-16">Disc</th>
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
                      {it.qty} <span className="text-gray-400 text-xs">{it.uom}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{inr(it.rate)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {it.discount > 0 ? `${it.discount}%` : "—"}
                    </td>
                    <td className="py-2.5 text-right tabular-nums font-semibold">
                      {inr(it.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Dispatch */}
          {data.dispatchOption && (
            <div className="pb-4 text-sm text-gray-700">
              <span className="text-gray-500">Dispatch mode: </span>
              <span className="font-medium">{data.dispatchOption.name}</span>
            </div>
          )}

          {/* Totals */}
          <div className="flex justify-end pb-6 border-b border-gray-200">
            <div className="w-72 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Sub-total</span>
                <span className="tabular-nums">{inr(totals!.lineTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Tax (goods)</span>
                <span className="tabular-nums">{inr(totals!.tax)}</span>
              </div>
              {(data.transportCharge ?? 0) > 0 && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Transport</span>
                    <span className="tabular-nums">{inr(data.transportCharge ?? 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Tax (freight)</span>
                    <span className="tabular-nums">{inr(data.transportTax ?? 0)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-lg pt-2 border-t border-gray-200 mt-1">
                <span className="font-bold">Total</span>
                <span className="font-bold tabular-nums">{inr(totals!.grand)}</span>
              </div>
            </div>
          </div>

          {/* Notes / Terms */}
          {data.notes && (
            <div className="pt-6">
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">
                Notes
              </div>
              <div className="text-sm text-gray-700 whitespace-pre-line">{data.notes}</div>
            </div>
          )}

          <div className="pt-8 mt-8 border-t border-gray-200 text-xs text-gray-500 text-center">
            This is a system-generated quotation. Prices are valid until{" "}
            <strong>{fmtDate(data.validUntil)}</strong>. Please contact us to confirm
            availability before placing an order.
          </div>
        </div>
      </div>
    </div>
  );
};
