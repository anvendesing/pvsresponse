// Authenticated, print-friendly view of a Pick List. Opens in a new tab
// from the desktop Picking screen and immediately fires the browser
// print dialog so the operator can either print on paper or "Save as
// PDF" from the same dialog. Layout is intentionally dense so a typical
// pick list fits one A4 page; a signature strip at the bottom doubles
// as a chain-of-custody record.

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { api, type PickListRow, type PublicCompany } from "@/lib/api";
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

const binLabel = (
  b: { code?: string | null; zone?: string; rack?: string; shelf?: string; bin?: string } | null | undefined
): string => {
  if (!b) return "—";
  if (b.code) return b.code;
  return [b.zone, b.rack, b.shelf, b.bin].filter(Boolean).join("-") || "—";
};

const variantAttrs = (
  v: { size?: string | null; color?: string | null; grade?: string | null } | null | undefined
): string =>
  [v?.size, v?.color, v?.grade].filter(Boolean).join(" / ");

export const PrintPickList = () => {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const [pl, setPl] = useState<PickListRow | null>(null);
  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { brandName } = useBrand();

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const [list, comp] = await Promise.all([
          api.pickList(id),
          api.publicCompany().catch(() => null),
        ]);
        if (!cancelled) {
          setPl(list);
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

  // Auto-fire the print dialog once the document has rendered. Most
  // operators arrive via "Print" buttons that already pass ?print=1, so
  // the dialog opens without an extra click. Setting print=0 (or
  // omitting the flag) is the screen-preview mode.
  useEffect(() => {
    if (params.get("print") !== "0" && pl) {
      const t = window.setTimeout(() => window.print(), 350);
      return () => window.clearTimeout(t);
    }
  }, [params, pl]);

  if (error) {
    return (
      <div className="min-h-screen grid place-items-center p-6 bg-white text-red-700">
        Failed to load pick list: {error}
      </div>
    );
  }
  if (!pl) {
    return (
      <div className="min-h-screen grid place-items-center bg-white text-gray-500">
        Loading pick list…
      </div>
    );
  }

  const totalToPick = pl.items.reduce((s, i) => s + i.qtyToPick, 0);
  const totalPicked = pl.items.reduce((s, i) => s + i.qtyPicked, 0);

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="print:hidden bg-white border-b shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            Internal pick list · warehouse copy
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
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                Pick List
              </div>
              <div className="text-2xl font-bold text-gray-900 mt-0.5">
                {pl.pickListNo}
              </div>
              <div className="text-xs text-gray-500 mt-1 capitalize">
                Status · <strong>{pl.status}</strong>
              </div>
            </div>
          </div>

          {/* Order + worker meta */}
          <div className="grid grid-cols-3 gap-4 py-5 border-b border-gray-200 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                Sales order
              </div>
              <div className="font-bold text-gray-900 mt-0.5">
                {pl.salesOrder?.soNo ?? "—"}
              </div>
              <div className="text-gray-700 mt-1">
                {pl.salesOrder?.customer?.name ?? "—"}
              </div>
              {pl.salesOrder?.customer?.city && (
                <div className="text-xs text-gray-500">
                  {pl.salesOrder.customer.city}
                </div>
              )}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                Claimed by
              </div>
              <div className="font-bold text-gray-900 mt-0.5">
                {pl.assignedTo?.name ?? "Unclaimed"}
              </div>
              {pl.assignedTo && (
                <div className="text-xs text-gray-500">
                  @{pl.assignedTo.username}
                </div>
              )}
              {pl.claimedAt && (
                <div className="text-xs text-gray-500 mt-1">
                  Claimed {fmt(pl.claimedAt)}
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                Created
              </div>
              <div className="font-semibold text-gray-900 mt-0.5">
                {fmt(pl.createdAt)}
              </div>
              {pl.pickedAt && (
                <>
                  <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mt-2">
                    Picked
                  </div>
                  <div className="font-semibold text-gray-900">
                    {fmt(pl.pickedAt)}
                  </div>
                </>
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
                  <th className="py-2 pr-3 w-32">Bin</th>
                  <th className="py-2 pr-2 text-right w-16">To pick</th>
                  <th className="py-2 pr-2 text-right w-16">Picked</th>
                  <th className="py-2 text-right w-16">Stock</th>
                </tr>
              </thead>
              <tbody>
                {pl.items.map((it, i) => {
                  const short = it.qtyPicked < it.qtyToPick;
                  const stockShort =
                    (it.variant?.stockOnHand ?? it.product?.stockOnHand ?? 0) <
                    it.qtyToPick;
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
                      <td className="py-2 pr-3 font-mono text-xs">
                        {binLabel(it.bin)}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums font-semibold">
                        {it.qtyToPick}
                      </td>
                      <td
                        className={`py-2 pr-2 text-right tabular-nums min-w-[3rem] ${
                          short && it.qtyPicked > 0 ? "text-amber-700 font-semibold" : ""
                        }`}
                      >
                        {/* Paper pick lists: leave Picked blank until the
                            warehouse writes a qty by hand. Showing "0
                            (-40)" clutters the printout and duplicates
                            what To pick already states. */}
                        {it.qtyPicked > 0 ? it.qtyPicked : ""}
                      </td>
                      <td
                        className={`py-2 text-right tabular-nums ${
                          stockShort ? "text-red-700 font-semibold" : "text-gray-600"
                        }`}
                      >
                        {it.variant?.stockOnHand ?? it.product?.stockOnHand ?? 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-400 font-semibold">
                  <td colSpan={3} className="py-2 pr-2 text-right text-gray-700">
                    Totals
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {totalToPick}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {totalPicked}
                  </td>
                  <td className="py-2" />
                </tr>
              </tfoot>
            </table>
          </div>

          {pl.notes && (
            <div className="pt-4 border-t border-gray-200">
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">
                Notes
              </div>
              <div className="text-sm text-gray-700 whitespace-pre-line">
                {pl.notes}
              </div>
            </div>
          )}

          {/* Signature strip */}
          <div className="grid grid-cols-2 gap-12 pt-12 mt-12 border-t border-gray-300">
            <SignatureBlock label="Picked by" />
            <SignatureBlock label="Verified by" />
          </div>

          <div className="mt-6 text-center text-xs text-gray-400">
            Generated {fmt(new Date())} · {brandName} warehouse pick list
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
