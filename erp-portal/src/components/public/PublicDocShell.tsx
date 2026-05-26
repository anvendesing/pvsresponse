// Shared shell for the public-facing document viewers (Quote, Invoice,
// Sales Order, Packing Slip). Renders the company header, customer
// block, document number/status badge, and provides a slot for the
// document body (line items + totals). Print-friendly.

import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type PublicCompany } from "@/lib/api";

const fmtDate = (d: string | Date) => {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatCompanyAddress = (c: PublicCompany | null): string => {
  if (!c) return "";
  const parts: string[] = [];
  if (c.addressLine) parts.push(c.addressLine);
  const cityLine = [c.city, c.state, c.pincode].filter(Boolean).join(", ");
  if (cityLine) parts.push(cityLine);
  if (c.country && c.country.toLowerCase() !== "india") parts.push(c.country);
  return parts.join("\n");
};

interface DocCustomer {
  name: string;
  gst?: string | null;
  city?: string | null;
  contact?: string | null;
}

interface MetaItem {
  label: string;
  value: ReactNode;
}

interface Props {
  // Title shown at the top right (e.g. "Tax Invoice", "Sales Order").
  docKindLabel: string;
  docNo: string;
  // Optional secondary line under the doc number, e.g. "Revision 2".
  secondaryDocLabel?: string;
  statusLabel: string;
  statusClass: string; // tailwind classes for the status badge
  bannerText: string; // top action bar copy (left side)
  customer: DocCustomer;
  // Right-hand column on the customer row, typically a list of dates.
  meta: MetaItem[];
  // Footer note shown below the doc body.
  footerNote?: string;
  children: ReactNode;
  // 404 / loading hooks let pages render specific copy.
  loading?: boolean;
  errorMessage?: string | null;
}

export const fmtPublicDate = fmtDate;

export const PublicDocShell = ({
  docKindLabel,
  docNo,
  secondaryDocLabel,
  statusLabel,
  statusClass,
  bannerText,
  customer,
  meta,
  footerNote,
  children,
  loading,
  errorMessage,
}: Props) => {
  const [params] = useSearchParams();
  const [company, setCompany] = useState<PublicCompany | null>(null);

  useEffect(() => {
    void api
      .publicCompany()
      .then((c) => setCompany(c))
      .catch(() => setCompany(null));
  }, []);

  // ?print=1 auto-fires the print dialog once we've rendered.
  useEffect(() => {
    if (params.get("print") === "1" && !loading && !errorMessage) {
      const t = window.setTimeout(() => window.print(), 300);
      return () => window.clearTimeout(t);
    }
  }, [params, loading, errorMessage]);

  if (errorMessage) {
    return (
      <div className="min-h-screen bg-gray-100 grid place-items-center p-6">
        <div className="max-w-md w-full bg-white rounded-lg shadow p-8 text-center">
          <div className="text-5xl mb-3">⚠</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            {docKindLabel} unavailable
          </h1>
          <p className="text-sm text-gray-600">{errorMessage}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 grid place-items-center text-gray-500">
        Loading {docKindLabel.toLowerCase()}…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Top action bar (hidden on print) */}
      <div className="print:hidden bg-white border-b shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="text-sm text-gray-500">{bannerText}</div>
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
          {/* Header: company + doc number */}
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
                {docKindLabel}
              </div>
              <div className="text-xl font-bold text-gray-900 mt-0.5">{docNo}</div>
              {secondaryDocLabel && (
                <div className="text-xs text-gray-500">{secondaryDocLabel}</div>
              )}
              <span
                className={`inline-block mt-2 px-2.5 py-0.5 text-xs font-semibold rounded-full border ${statusClass}`}
              >
                {statusLabel}
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
                {customer.name}
              </div>
              {customer.city && (
                <div className="text-sm text-gray-600">{customer.city}</div>
              )}
              {customer.gst && (
                <div className="text-xs text-gray-500 mt-1">
                  GSTIN: <strong>{customer.gst}</strong>
                </div>
              )}
              {customer.contact && (
                <div className="text-xs text-gray-500">{customer.contact}</div>
              )}
            </div>
            <div className="text-right space-y-1">
              {meta.map((m, i) => (
                <div key={i} className="text-sm">
                  <span className="text-gray-500">{m.label}: </span>
                  <strong>{m.value}</strong>
                </div>
              ))}
            </div>
          </div>

          {children}

          {footerNote && (
            <div className="pt-8 mt-8 border-t border-gray-200 text-xs text-gray-500 text-center">
              {footerNote}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
