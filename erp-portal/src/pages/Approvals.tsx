import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Check, ClipboardList, FileText, Filter, ScrollText, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { Toolbar } from "@/components/common/Toolbar";
import { inr } from "@/lib/format";
import { cn } from "@/lib/cn";
import { api, apiEnabled, type ApprovalRow, type SalesOrderRow } from "@/lib/api";

interface Approval {
  id: string;
  ref: string;
  type: string;
  requestedBy: string;
  date: string;
  amount: number;
  priority: "low" | "med" | "high";
  reason: string;
}

const MOCK: Approval[] = [
  { id: "AP1", ref: "PR-2206", type: "Purchase Request", requestedBy: "Sandeep Kumar", date: "2 hrs ago", amount: 425000, priority: "high", reason: "Q3 forecast restock for Bearing 6205, MS Plate 6mm." },
  { id: "AP2", ref: "ADJ-203", type: "Stock Adjustment", requestedBy: "Naveen Pillai", date: "3 hrs ago", amount: -28400, priority: "med", reason: "Cycle count variance on Hex Bolt M10x40 in WH-RAW/A-2-3." },
  { id: "AP3", ref: "PO-2026-1124", type: "PO Amendment", requestedBy: "Procurement Team", date: "5 hrs ago", amount: 90000, priority: "med", reason: "Vendor revised price for Steel Coil 2mm by ₹2/kg." },
  { id: "AP4", ref: "PR-2210", type: "Purchase Request", requestedBy: "Maintenance Team", date: "6 hrs ago", amount: 165000, priority: "low", reason: "Spare parts for Cutter 1 — preventive maintenance." },
  { id: "AP5", ref: "OVR-19", type: "Price Override", requestedBy: "Counter 2", date: "Yesterday", amount: -12000, priority: "low", reason: "Bulk discount for Hindustan Motors Ltd · 4% over policy." },
];

const fromApi = (a: ApprovalRow): Approval => ({
  id: a.id,
  ref: a.ref,
  type: a.type,
  requestedBy: a.requestedBy,
  date: new Date(a.createdAt).toLocaleString(),
  amount: a.amount,
  priority: a.priority,
  reason: a.reason,
});

const priorityTone = (p: Approval["priority"]) =>
  p === "high" ? "danger" : p === "med" ? "warning" : "info";

export const Approvals = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const deepLinkId = searchParams.get("id");
  const [list, setList] = useState<Approval[]>(MOCK);
  const [selectedId, setSelectedId] = useState<string | null>(list[0]?.id ?? null);
  // Banner shown after granting a Credit Limit approval -> Sales Order
  // was created as a side-effect.
  const [banner, setBanner] = useState<{
    text: string;
    salesOrder?: SalesOrderRow;
  } | null>(null);

  useEffect(() => {
    if (!apiEnabled) return;
    let cancelled = false;
    api
      .approvals()
      .then((rows) => {
        if (cancelled) return;
        const mapped = rows.map(fromApi);
        setList(mapped);
        // Honour ?id=... deep-link from the Quote credit-hold flow; otherwise
        // pre-select the first item.
        const initialId =
          (deepLinkId && mapped.find((m) => m.id === deepLinkId)?.id) ??
          mapped[0]?.id ??
          null;
        setSelectedId(initialId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [deepLinkId]);

  const selected = list.find((a) => a.id === selectedId);

  const decide = async (id: string, decision: "approved" | "rejected") => {
    const target = list.find((a) => a.id === id);
    // For rejections we ask for a reason - it gets appended to the
    // Approval audit row and to the source quote's notes (when the
    // approval is a Credit Limit one). Cancelling the prompt aborts
    // the whole reject so the operator doesn't accidentally reject
    // without context.
    let reason: string | undefined;
    if (decision === "rejected") {
      const input = window.prompt(
        `Reason for rejecting ${target?.ref ?? "this approval"}?\n(stored on the audit log; will appear on the quote if it's a Credit-Limit approval)`,
        ""
      );
      if (input === null) return;
      reason = input.trim() || undefined;
    }
    if (apiEnabled) {
      try {
        const r = await api.decideApproval(id, decision, reason);
        // /approvals/:id/decide returns:
        //   { approval, salesOrder } - Credit Limit approved -> SO created
        //   { approval, quote }      - Credit Limit rejected -> quote bounced
        if (
          decision === "approved" &&
          target?.type === "Credit Limit" &&
          r &&
          typeof r === "object" &&
          "salesOrder" in r &&
          r.salesOrder
        ) {
          setBanner({
            text: `Approved. Sales Order ${r.salesOrder.soNo} was created from quote ${target.ref}.`,
            salesOrder: r.salesOrder,
          });
        } else if (decision === "approved") {
          setBanner({ text: `Approval ${target?.ref ?? ""} granted.` });
        } else if (
          target?.type === "Credit Limit" &&
          r &&
          typeof r === "object" &&
          "quote" in r &&
          r.quote
        ) {
          // Quote was bounced back to 'rejected' - tell the operator
          // explicitly so they know the deal is no longer live.
          setBanner({
            text: `Rejected. Quote ${target.ref} moved to 'rejected'. The salesperson will see your reason on the quote.`,
          });
        } else {
          setBanner({ text: `Approval ${target?.ref ?? ""} rejected.` });
        }
      } catch (e) {
        setBanner({ text: `Could not record decision: ${(e as Error).message}` });
      }
    }
    setList((prev) => {
      const next = prev.filter((a) => a.id !== id);
      if (selectedId === id) setSelectedId(next[0]?.id ?? null);
      return next;
    });
  };

  return (
    <div className="h-full flex flex-col">
      <Toolbar
        left={
          <>
            <h2 className="text-h3 font-bold mr-2">Approvals</h2>
            <Chip tone="warning">{list.length} pending</Chip>
          </>
        }
        right={
          <>
            <Button variant="outline" size="sm" icon={<Filter size={14} />}>
              Filters
            </Button>
            <Button variant="outline" size="sm" icon={<ScrollText size={14} />}>
              Audit Log
            </Button>
          </>
        }
      />

      {banner && (
        <div className="px-4 py-2 bg-success-soft border-b border-success/40 text-ink text-body-sm flex items-center gap-2">
          <Check size={16} className="text-success" />
          <span className="flex-1">{banner.text}</span>
          {banner.salesOrder && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/sales-orders?id=${banner.salesOrder!.id}`)}
            >
              Open Sales Order
            </Button>
          )}
          <button
            onClick={() => setBanner(null)}
            className="text-ink-muted hover:text-ink text-caption"
          >
            dismiss
          </button>
        </div>
      )}

      <div className="flex-1 grid grid-cols-12 min-h-0 bg-canvas">
        <aside className="col-span-5 lg:col-span-4 xl:col-span-3 bg-surface border-r border-border overflow-y-auto">
          {list.length === 0 && (
            <div className="p-12 text-center text-ink-muted">
              <Check size={32} className="text-success mx-auto mb-3" />
              <div className="text-body font-semibold text-ink">All caught up</div>
              <div className="text-caption mt-1">No pending approvals.</div>
            </div>
          )}
          {list.map((a) => {
            const sel = a.id === selectedId;
            return (
              <button
                key={a.id}
                onClick={() => setSelectedId(a.id)}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b border-border/60 transition-colors",
                  sel ? "bg-primary-50" : "hover:bg-canvas"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-caption font-semibold text-primary">{a.ref}</span>
                  <Chip tone={priorityTone(a.priority)} size="sm" className="capitalize">{a.priority}</Chip>
                </div>
                <div className="text-body-sm font-semibold mt-1">{a.type}</div>
                <div className="text-caption text-ink-muted flex items-center justify-between mt-0.5">
                  <span>{a.requestedBy}</span>
                  <span>{a.date}</span>
                </div>
                <div className={cn("text-body-sm font-bold tnum mt-1", a.amount < 0 ? "text-danger" : "text-ink")}>
                  {inr(a.amount)}
                </div>
              </button>
            );
          })}
        </aside>

        <section className="col-span-7 lg:col-span-8 xl:col-span-9 overflow-y-auto p-4">
          {selected ? (
          <Card
            title={
              <div className="flex items-center gap-2">
                <ClipboardList size={18} className="text-primary" />
                <span>{selected.type}</span>
                <span className="font-mono text-caption text-ink-muted">{selected.ref}</span>
              </div>
            }
            actions={
              selected.type === "Customer Return" ? (
                // Customer Return approvals are line-item-wise: direct the
                // approver to the Return drawer instead of a single decide button.
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/returns?focus=${selected.ref}`)}
                >
                  Open Return →
                </Button>
              ) : (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" icon={<X size={14} />} onClick={() => decide(selected.id, "rejected")}>
                  Reject
                </Button>
                <Button size="sm" icon={<Check size={14} />} onClick={() => decide(selected.id, "approved")}>
                  Approve · F8
                </Button>
              </div>
              )
            }
              accent="warning"
            >
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <Stat label="Requested by" value={selected.requestedBy} />
                <Stat label="Submitted" value={selected.date} />
                <Stat label="Amount" value={inr(selected.amount)} mono />
                <Stat label="Priority" value={selected.priority.toUpperCase()} />
              </div>

              <div className="bg-canvas border border-border rounded-md p-3 mb-4">
                <div className="text-caption font-semibold uppercase tracking-wider text-ink-muted mb-1">
                  Reason
                </div>
                <div className="text-body text-ink">{selected.reason}</div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card title="Approval Chain" noPadding>
                  <div className="divide-y divide-border">
                    {[
                      { step: "1", who: "Department Head", state: "approved", time: "2 hrs ago" },
                      { step: "2", who: "Procurement Manager", state: "approved", time: "1 hr ago" },
                      { step: "3", who: "You · Plant Supervisor", state: "pending", time: "now" },
                      { step: "4", who: "VP Operations", state: "queued", time: "—" },
                    ].map((s) => (
                      <div key={s.step} className="flex items-center gap-3 px-3 py-2.5">
                        <div
                          className={cn(
                            "h-7 w-7 rounded-full grid place-items-center font-bold text-caption",
                            s.state === "approved"
                              ? "bg-success-soft text-success"
                              : s.state === "pending"
                                ? "bg-primary text-white"
                                : "bg-canvas text-ink-muted border border-border"
                          )}
                        >
                          {s.state === "approved" ? <Check size={14} /> : s.step}
                        </div>
                        <div className="flex-1">
                          <div className="text-body-sm font-semibold">{s.who}</div>
                          <div className="text-caption text-ink-muted">{s.time}</div>
                        </div>
                        <Chip
                          tone={
                            s.state === "approved"
                              ? "success"
                              : s.state === "pending"
                                ? "warning"
                                : "neutral"
                          }
                          size="sm"
                          className="capitalize"
                        >
                          {s.state}
                        </Chip>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card title="Attached Documents" noPadding>
                  <div className="divide-y divide-border">
                    {[
                      { name: "Vendor quote — Q-2206.pdf", size: "412 KB" },
                      { name: "BOM consumption snapshot.xlsx", size: "94 KB" },
                      { name: "Forecast model — Q3.pdf", size: "1.2 MB" },
                    ].map((d) => (
                      <div key={d.name} className="flex items-center gap-3 px-3 py-2.5 hover:bg-canvas cursor-pointer">
                        <FileText size={16} className="text-primary" />
                        <div className="flex-1 min-w-0">
                          <div className="text-body-sm font-semibold truncate">{d.name}</div>
                          <div className="text-caption text-ink-muted">{d.size}</div>
                        </div>
                        <Button size="sm" variant="ghost">
                          Open →
                        </Button>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </Card>
          ) : (
            <div className="h-full grid place-items-center text-ink-muted">No pending items</div>
          )}
        </section>
      </div>
    </div>
  );
};

const Stat = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <div className="bg-canvas border border-border rounded-md p-3">
    <div className="text-caption text-ink-muted uppercase tracking-wide font-semibold">{label}</div>
    <div className={cn("text-body font-bold text-ink mt-1", mono && "tnum")}>{value}</div>
  </div>
);
