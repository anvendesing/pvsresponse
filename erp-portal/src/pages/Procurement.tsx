// Procurement landing page - vendors, purchase orders, GRN.
//
// Three tabs:
//   * po       - list of POs with filter strip + actions (new / approve
//                / cancel / receive). Click a row to open the editor.
//   * vendors  - vendor catalog with add / edit / soft-delete.
//   * grn      - live GRN queue + QC update strip.
//
// All previously-mocked data (the "8 trucks", QC pass/reject samples)
// has been removed - everything reads from the procurement backend.

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ClipboardList,
  Download,
  FileText,
  PackageCheck,
  Pencil,
  Plus,
  Search,
  Star,
  Truck,
  X,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { DataTable, type Column } from "@/components/common/DataTable";
import { Input } from "@/components/common/Input";
import { Kpi } from "@/components/common/Kpi";
import { Toolbar } from "@/components/common/Toolbar";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import type { PurchaseOrder, Vendor } from "@/data/types";
import { dd, inr, num } from "@/lib/format";
import { cn } from "@/lib/cn";
import { VendorEditor } from "@/components/procurement/VendorEditor";
import { PoEditor } from "@/components/procurement/PoEditor";
import { GrnReceiveModal } from "@/components/procurement/GrnReceiveModal";
import { GrnDetailModal } from "@/components/procurement/GrnDetailModal";
import { ShareDocumentMenu } from "@/components/common/ShareDocumentMenu";

const poTone = (s: PurchaseOrder["status"]) => {
  switch (s) {
    case "approved":
      return "primary" as const;
    case "received":
      return "success" as const;
    case "partial":
      return "warning" as const;
    case "draft":
      return "neutral" as const;
    case "closed":
      return "info" as const;
    case "cancelled":
      return "danger" as const;
  }
};

const qcTone = (s: "pending" | "pass" | "rework" | "reject") =>
  s === "pass" ? "success" : s === "rework" ? "warning" : s === "reject" ? "danger" : "info";

export const Procurement = () => {
  const [tab, setTab] = useState<"po" | "vendors" | "grn">("po");
  const [q, setQ] = useState("");
  const [vendorQ, setVendorQ] = useState("");
  const [poStatus, setPoStatus] = useState<PurchaseOrder["status"] | "all">("all");

  const livePos = useApi(() => api.purchaseOrders(), []);
  const liveVendors = useApi(() => api.vendors({ includeInactive: true }), []);
  const liveGrns = useApi(() => api.grns(), []);
  const purchaseOrders = livePos.data ?? [];
  const vendors = liveVendors.data ?? [];
  const grns = liveGrns.data ?? [];

  // Modal state.
  const [vendorEditing, setVendorEditing] = useState<{ vendor: Vendor | null } | null>(null);
  const [poEditing, setPoEditing] = useState<{ poId: string | null } | null>(null);
  const [grnReceiving, setGrnReceiving] = useState<string | null>(null); // poId
  // GRN currently open in the detail/QC modal. Null when no GRN
  // is being viewed; we store the full row (not just the id) so
  // the modal can render immediately without an extra fetch.
  const [viewingGrnId, setViewingGrnId] = useState<string | null>(null);
  const [poDetail, setPoDetail] = useState<Awaited<
    ReturnType<typeof api.getPurchaseOrder>
  > | null>(null);

  // Banner.
  const [banner, setBanner] = useState<{
    tone: "ok" | "err";
    text: string;
  } | null>(null);
  // Auto-clear after 6 seconds so the banner doesn't pile up.
  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner(null), 6000);
    return () => window.clearTimeout(t);
  }, [banner]);

  // Pull full PO detail when the user opens the editor or receive
  // modal - the list view doesn't include line-level products.
  useEffect(() => {
    if (poEditing?.poId) {
      void api.getPurchaseOrder(poEditing.poId).then(setPoDetail).catch((e) => {
        setBanner({ tone: "err", text: (e as Error).message });
      });
    } else if (grnReceiving) {
      void api.getPurchaseOrder(grnReceiving).then(setPoDetail).catch((e) => {
        setBanner({ tone: "err", text: (e as Error).message });
      });
    } else {
      setPoDetail(null);
    }
  }, [poEditing?.poId, grnReceiving]);

  const filteredPos = useMemo(() => {
    return purchaseOrders.filter((p) => {
      if (poStatus !== "all" && p.status !== poStatus) return false;
      if (!q) return true;
      const t = q.toLowerCase();
      return p.poNo.toLowerCase().includes(t) || p.vendor.toLowerCase().includes(t);
    });
  }, [q, poStatus, purchaseOrders]);

  const filteredVendors = useMemo(() => {
    if (!vendorQ) return vendors;
    const t = vendorQ.toLowerCase();
    return vendors.filter(
      (v) =>
        v.name.toLowerCase().includes(t) ||
        v.code.toLowerCase().includes(t) ||
        v.city.toLowerCase().includes(t) ||
        v.gst.toLowerCase().includes(t)
    );
  }, [vendors, vendorQ]);

  const totalSpend = vendors.reduce((s, v) => s + v.totalSpend, 0);
  const openPOs = purchaseOrders.filter((p) =>
    ["approved", "partial", "draft"].includes(p.status)
  ).length;
  const overdueCount = purchaseOrders.filter(
    (p) =>
      p.status !== "received" &&
      p.status !== "closed" &&
      p.status !== "cancelled" &&
      new Date(p.expectedDate) < new Date()
  ).length;
  const activeVendors = vendors.filter((v) => v.active).length;

  const refreshAll = async () => {
    await Promise.all([livePos.refetch(), liveVendors.refetch(), liveGrns.refetch()]);
  };

  // ---- PO actions ----
  const approvePo = async (id: string, poNo: string) => {
    try {
      await api.approvePurchaseOrder(id);
      setBanner({ tone: "ok", text: `${poNo} approved.` });
      await refreshAll();
    } catch (e) {
      setBanner({ tone: "err", text: (e as Error).message });
    }
  };
  const cancelPo = async (id: string, poNo: string) => {
    if (!window.confirm(`Cancel ${poNo}? This cannot be undone.`)) return;
    try {
      await api.cancelPurchaseOrder(id);
      setBanner({ tone: "ok", text: `${poNo} cancelled.` });
      await refreshAll();
    } catch (e) {
      setBanner({ tone: "err", text: (e as Error).message });
    }
  };
  const closePo = async (id: string, poNo: string) => {
    if (!window.confirm(`Close ${poNo}? This freezes the PO from further receipts.`)) return;
    try {
      await api.closePurchaseOrder(id);
      setBanner({ tone: "ok", text: `${poNo} closed.` });
      await refreshAll();
    } catch (e) {
      setBanner({ tone: "err", text: (e as Error).message });
    }
  };

  // ---- Columns ----
  const poCols: Column<PurchaseOrder>[] = [
    {
      key: "no",
      header: "PO Number",
      cell: (r) => (
        <button
          type="button"
          onClick={() => setPoEditing({ poId: r.id })}
          className="font-mono text-caption font-semibold text-primary hover:underline"
        >
          {r.poNo}
        </button>
      ),
      width: "150px",
      sortable: true,
      sortValue: (r) => r.poNo,
    },
    {
      key: "vendor",
      header: "Vendor",
      cell: (r) => <span className="font-semibold">{r.vendor}</span>,
      sortable: true,
      sortValue: (r) => r.vendor,
    },
    {
      key: "date",
      header: "PO Date",
      cell: (r) => <span className="text-ink-muted text-caption">{dd(r.date)}</span>,
      width: "110px",
    },
    {
      key: "exp",
      header: "Expected",
      cell: (r) => {
        const overdue =
          new Date(r.expectedDate) < new Date() &&
          r.status !== "received" &&
          r.status !== "closed" &&
          r.status !== "cancelled";
        return (
          <span
            className={cn(
              "text-caption",
              overdue ? "text-danger font-semibold" : "text-ink-muted"
            )}
          >
            {dd(r.expectedDate)}
          </span>
        );
      },
      width: "110px",
    },
    {
      key: "items",
      header: "Items",
      align: "center",
      cell: (r) => <span className="tnum">{r.itemCount}</span>,
      width: "70px",
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (r) => <span className="font-bold tnum">{inr(r.amount)}</span>,
      width: "130px",
      sortable: true,
      sortValue: (r) => r.amount,
    },
    {
      key: "received",
      header: "Received",
      cell: (r) => (
        <div className="flex items-center gap-2 min-w-[100px]">
          <div className="flex-1 h-1.5 bg-canvas rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full",
                r.receivedPct === 100 ? "bg-success" : r.receivedPct > 0 ? "bg-warning" : "bg-border"
              )}
              style={{ width: `${r.receivedPct}%` }}
            />
          </div>
          <span className="text-caption tnum w-9 text-right">{r.receivedPct}%</span>
        </div>
      ),
      width: "150px",
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <Chip tone={poTone(r.status)} size="sm">
          {r.status}
        </Chip>
      ),
      width: "100px",
    },
    {
      key: "actions",
      header: "",
      cell: (r) => (
        <div className="flex items-center gap-1 justify-end">
          {r.status === "draft" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => approvePo(r.id, r.poNo)}
            >
              Approve
            </Button>
          )}
          {(r.status === "approved" || r.status === "partial") && (
            <Button
              size="sm"
              icon={<PackageCheck size={12} />}
              onClick={() => setGrnReceiving(r.id)}
            >
              Receive
            </Button>
          )}
          {/* Share: only meaningful once the PO has actually been
              issued. We keep a draft un-shareable so it can't leak
              before approval. The menu lazy-mints a token on first
              open, so PO rows that have never been shared still
              work without any precomputation. */}
          {r.status !== "draft" && r.status !== "cancelled" && (
            <ShareDocumentMenu
              size="sm"
              label="Share"
              descriptor={{
                kind: "purchase-order",
                id: r.id,
                docNo: r.poNo,
                shareToken: r.shareToken,
                customerName: r.vendor,
                customerContact: r.vendorContact ?? r.vendorEmail ?? null,
                total: r.amount,
                contextLine: `Expected by ${dd(r.expectedDate)}`,
                rotateToken: async (id) =>
                  (await api.rotatePurchaseOrderShareToken(id)).shareToken,
                onTokenChanged: (token) => {
                  // Patch the cached row so a second open of the menu
                  // doesn't re-mint. The next refetch overwrites this
                  // anyway, but this keeps the UI snappy.
                  r.shareToken = token;
                },
              }}
            />
          )}
          {(r.status === "draft" || r.status === "approved") && (
            <button
              onClick={() => cancelPo(r.id, r.poNo)}
              className="text-caption text-danger hover:underline px-1.5"
            >
              Cancel
            </button>
          )}
          {(r.status === "partial" || r.status === "received") && (
            <button
              onClick={() => closePo(r.id, r.poNo)}
              className="text-caption text-ink-muted hover:underline px-1.5"
            >
              Close
            </button>
          )}
        </div>
      ),
      width: "260px",
    },
  ];

  const vendorCols: Column<Vendor>[] = [
    {
      key: "name",
      header: "Vendor",
      cell: (r) => (
        <button
          type="button"
          onClick={() => setVendorEditing({ vendor: r })}
          className="text-left"
        >
          <div className="font-semibold hover:text-primary">{r.name}</div>
          <div className="text-caption text-ink-muted font-mono">
            {r.code} {r.gst ? ` · ${r.gst}` : ""}
          </div>
        </button>
      ),
      sortable: true,
      sortValue: (r) => r.name,
    },
    {
      key: "city",
      header: "City",
      cell: (r) => <span className="text-ink-muted">{r.city}</span>,
      width: "120px",
    },
    {
      key: "contact",
      header: "Contact",
      cell: (r) => (
        <div className="text-caption">
          <div>{r.contact || "—"}</div>
          {r.email && <div className="text-ink-muted">{r.email}</div>}
        </div>
      ),
      width: "180px",
    },
    {
      key: "lt",
      header: "Lead Time",
      align: "center",
      cell: (r) => <span className="tnum">{r.leadTimeDays}d</span>,
      width: "100px",
      sortable: true,
      sortValue: (r) => r.leadTimeDays,
    },
    {
      key: "rating",
      header: "Rating",
      cell: (r) => (
        <div className="flex items-center gap-1">
          <Star size={12} className="fill-warning text-warning" />
          <span className="font-semibold">{r.rating.toFixed(1)}</span>
        </div>
      ),
      width: "100px",
      sortable: true,
      sortValue: (r) => r.rating,
    },
    {
      key: "open",
      header: "Open POs",
      align: "center",
      cell: (r) => (
        <Chip size="sm" tone={r.outstandingPO > 4 ? "warning" : "neutral"}>
          {r.outstandingPO}
        </Chip>
      ),
      width: "100px",
    },
    {
      key: "spend",
      header: "Total Spend",
      align: "right",
      cell: (r) => <span className="font-bold tnum">{inr(r.totalSpend)}</span>,
      width: "150px",
      sortable: true,
      sortValue: (r) => r.totalSpend,
    },
    {
      key: "active",
      header: "Status",
      cell: (r) =>
        r.active ? (
          <Chip size="sm" tone="success">active</Chip>
        ) : (
          <Chip size="sm" tone="neutral">inactive</Chip>
        ),
      width: "100px",
    },
    {
      key: "actions",
      header: "",
      cell: (r) => (
        <Button
          size="sm"
          variant="ghost"
          icon={<Pencil size={12} />}
          onClick={() => setVendorEditing({ vendor: r })}
        >
          Edit
        </Button>
      ),
      width: "90px",
    },
  ];

  return (
    <div className="h-full flex flex-col">
      <Toolbar
        left={
          <>
            <h2 className="text-h3 font-bold mr-2">Procurement</h2>
            <div className="flex items-center gap-1 ml-2">
              {(
                [
                  { id: "po", label: "Purchase Orders" },
                  { id: "vendors", label: "Vendors" },
                  { id: "grn", label: "GRN & QC" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "h-7 px-3 rounded-md text-caption font-semibold transition-colors",
                    tab === t.id
                      ? "bg-primary text-white"
                      : "bg-canvas text-ink-muted hover:text-primary"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </>
        }
        right={
          <>
            <Button variant="outline" size="sm" icon={<Download size={14} />}>
              Export
            </Button>
            {tab === "po" && (
              <Button
                size="sm"
                icon={<Plus size={14} />}
                onClick={() => setPoEditing({ poId: null })}
              >
                New PO · F2
              </Button>
            )}
            {tab === "vendors" && (
              <Button
                size="sm"
                icon={<Plus size={14} />}
                onClick={() => setVendorEditing({ vendor: null })}
              >
                New vendor
              </Button>
            )}
          </>
        }
      />

      {banner && (
        <div
          className={cn(
            "px-4 py-2 border-b text-body-sm flex items-center gap-2",
            banner.tone === "ok"
              ? "bg-success-soft border-success text-success"
              : "bg-danger-soft border-danger text-danger"
          )}
        >
          {banner.tone === "ok" ? (
            <CheckCircle2 size={14} />
          ) : (
            <AlertTriangle size={14} />
          )}
          <span className="flex-1">{banner.text}</span>
          <button
            onClick={() => setBanner(null)}
            className="hover:bg-white/50 rounded p-0.5"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-3 bg-canvas border-b border-border">
        <Kpi
          label="Open POs"
          value={String(openPOs)}
          deltaSuffix=""
          icon={<FileText size={14} />}
          accent="primary"
        />
        <Kpi
          label="Overdue"
          value={String(overdueCount)}
          deltaSuffix=""
          icon={<ClipboardList size={14} />}
          accent={overdueCount > 0 ? "danger" : "primary"}
        />
        <Kpi
          label="Total Spend"
          value={inr(totalSpend)}
          deltaSuffix=""
          icon={<PackageCheck size={14} />}
          accent="success"
        />
        <Kpi
          label="Active Vendors"
          value={String(activeVendors)}
          deltaSuffix=""
          icon={<Building2 size={14} />}
          accent="primary"
        />
      </div>

      {tab === "po" && (
        <>
          <div className="px-4 py-3 bg-surface border-b border-border flex items-center gap-3 flex-wrap">
            <Input
              size="sm"
              iconLeft={<Search size={14} />}
              placeholder="Search PO, vendor…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="!h-8"
            />
            <div className="flex items-center gap-1 ml-2">
              {(
                [
                  "all",
                  "draft",
                  "approved",
                  "partial",
                  "received",
                  "closed",
                  "cancelled",
                ] as const
              ).map((s) => (
                <button
                  key={s}
                  onClick={() => setPoStatus(s)}
                  className={cn(
                    "h-7 px-3 rounded-md text-caption font-semibold capitalize transition-colors",
                    poStatus === s
                      ? "bg-primary text-white"
                      : "bg-canvas text-ink-muted hover:text-primary"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
            <span className="ml-auto text-caption text-ink-muted">
              {filteredPos.length} POs
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-auto bg-surface">
            {livePos.loading ? (
              <div className="p-8 text-center text-body-sm text-ink-muted">
                Loading…
              </div>
            ) : filteredPos.length === 0 ? (
              <div className="p-12 text-center text-body-sm text-ink-muted">
                <FileText size={28} className="mx-auto mb-2 text-ink-muted/50" />
                <div className="font-semibold">No purchase orders</div>
                <div className="mt-1">
                  Create vendors first, then click <strong>New PO</strong> to raise one.
                </div>
                <div className="mt-3">
                  <Button
                    size="sm"
                    icon={<Plus size={14} />}
                    onClick={() => setPoEditing({ poId: null })}
                  >
                    New PO
                  </Button>
                </div>
              </div>
            ) : (
              <DataTable
                rows={filteredPos}
                columns={poCols}
                rowKey={(r) => r.id}
              />
            )}
          </div>
        </>
      )}

      {tab === "vendors" && (
        <>
          <div className="px-4 py-3 bg-surface border-b border-border flex items-center gap-3 flex-wrap">
            <Input
              size="sm"
              iconLeft={<Search size={14} />}
              placeholder="Search vendor, code, city, GST…"
              value={vendorQ}
              onChange={(e) => setVendorQ(e.target.value)}
              className="!h-8"
            />
            <span className="ml-auto text-caption text-ink-muted">
              {filteredVendors.length} vendors
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-auto bg-surface">
            {liveVendors.loading ? (
              <div className="p-8 text-center text-body-sm text-ink-muted">
                Loading…
              </div>
            ) : filteredVendors.length === 0 ? (
              <div className="p-12 text-center text-body-sm text-ink-muted">
                <Building2 size={28} className="mx-auto mb-2 text-ink-muted/50" />
                <div className="font-semibold">No vendors yet</div>
                <div className="mt-1">Add your first supplier to start raising POs.</div>
                <div className="mt-3">
                  <Button
                    size="sm"
                    icon={<Plus size={14} />}
                    onClick={() => setVendorEditing({ vendor: null })}
                  >
                    New vendor
                  </Button>
                </div>
              </div>
            ) : (
              <DataTable
                rows={filteredVendors}
                columns={vendorCols}
                rowKey={(r) => r.id}
              />
            )}
          </div>
        </>
      )}

      {tab === "grn" && (
        <div className="flex-1 min-h-0 overflow-auto p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* GRN queue: pending + recent. Each card shows the PO,
              vendor, item count and net accepted qty. Click "View"
              to open the PO; the QC outcome can be patched in-place. */}
          <Card
            title="Goods receipts"
            subtitle="Most recent first"
            actions={<Chip tone="info">{grns.length} GRNs</Chip>}
          >
            {liveGrns.loading ? (
              <div className="p-6 text-center text-body-sm text-ink-muted">
                Loading…
              </div>
            ) : grns.length === 0 ? (
              <div className="p-6 text-center text-body-sm text-ink-muted">
                <Truck size={24} className="mx-auto mb-2 text-ink-muted/50" />
                <div className="font-semibold">No GRNs recorded yet</div>
                <div className="mt-1">
                  Approve a PO and click <strong>Receive</strong> on its row to record one.
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {grns.map((grn) => {
                  const accepted = grn.items.reduce(
                    (s, i) => s + i.receivedQty - i.rejectedQty,
                    0
                  );
                  const isPending = grn.qcStatus === "pending";
                  return (
                    <button
                      key={grn.id}
                      type="button"
                      onClick={() => setViewingGrnId(grn.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md border border-border hover:bg-canvas hover:border-primary text-left transition-colors"
                    >
                      <div className="h-9 w-9 rounded-md bg-primary-50 text-primary grid place-items-center shrink-0">
                        <Truck size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-body-sm font-semibold">
                          {grn.grnNo}
                          <span className="text-ink-muted font-normal">
                            {" "}
                            · {grn.po.poNo}
                          </span>
                        </div>
                        <div className="text-caption text-ink-muted truncate">
                          {grn.po.vendor.name} · {grn.items.length} line
                          {grn.items.length === 1 ? "" : "s"} ·{" "}
                          {num(accepted, 2)} accepted
                          {grn.truckNo ? ` · ${grn.truckNo}` : ""}
                        </div>
                      </div>
                      <Chip size="sm" tone={qcTone(grn.qcStatus)} className="capitalize shrink-0">
                        {grn.qcStatus}
                      </Chip>
                      {isPending ? (
                        <span className="h-7 inline-flex items-center px-2.5 rounded-md text-caption font-semibold bg-primary text-white shrink-0">
                          View &amp; approve
                        </span>
                      ) : (
                        <span className="h-7 inline-flex items-center px-2.5 rounded-md text-caption font-semibold border border-border text-ink-muted shrink-0">
                          View
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {/* QC outcomes summary. Replaces the old hardcoded
              pass/reject sample - now reflects actual GRN rows. */}
          <Card
            title="QC outcomes"
            subtitle="Across all GRNs"
            actions={
              grns.length > 0 ? (
                <Chip tone="success">
                  {Math.round(
                    (grns.filter((g) => g.qcStatus === "pass").length /
                      grns.length) *
                      100
                  )}
                  % pass
                </Chip>
              ) : null
            }
          >
            {grns.length === 0 ? (
              <div className="p-4 text-center text-body-sm text-ink-muted">
                Nothing to summarise yet.
              </div>
            ) : (
              <div className="space-y-2">
                {(["pass", "rework", "reject", "pending"] as const).map(
                  (outcome) => {
                    const matching = grns.filter(
                      (g) => g.qcStatus === outcome
                    );
                    if (matching.length === 0) return null;
                    return (
                      <div
                        key={outcome}
                        className="flex items-start gap-3 px-3 py-2 rounded-md border border-border"
                      >
                        <Chip size="sm" tone={qcTone(outcome)} className="mt-0.5 capitalize">
                          {outcome}
                        </Chip>
                        <div className="flex-1 min-w-0">
                          <div className="text-body-sm font-semibold">
                            {matching.length} GRN
                            {matching.length === 1 ? "" : "s"}
                          </div>
                          <div className="text-caption text-ink-muted truncate">
                            {matching
                              .slice(0, 3)
                              .map((g) => g.grnNo)
                              .join(", ")}
                            {matching.length > 3 ? "…" : ""}
                          </div>
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ---- Modals ---- */}
      {vendorEditing && (
        <VendorEditor
          vendor={vendorEditing.vendor}
          onClose={() => setVendorEditing(null)}
          onSaved={async (msg) => {
            setVendorEditing(null);
            setBanner({ tone: "ok", text: msg });
            await liveVendors.refetch();
          }}
        />
      )}

      {poEditing && (poEditing.poId === null || poDetail) && (
        <PoEditor
          po={
            poEditing.poId && poDetail
              ? {
                  id: poDetail.id,
                  poNo: poDetail.poNo,
                  status: poDetail.status,
                  vendorId: poDetail.vendorId,
                  expectedDate: poDetail.expectedDate,
                  notes: poDetail.notes,
                  items: poDetail.items.map((i) => ({
                    productId: i.productId,
                    qty: i.qty,
                    rate: i.rate,
                    product: {
                      sku: i.product.sku,
                      name: i.product.name,
                      uom: i.product.uom,
                    },
                  })),
                }
              : null
          }
          onClose={() => setPoEditing(null)}
          onSaved={async (_id, msg) => {
            setPoEditing(null);
            setBanner({ tone: "ok", text: msg });
            await refreshAll();
          }}
        />
      )}

      {grnReceiving && poDetail && (
        <GrnReceiveModal
          po={{
            id: poDetail.id,
            poNo: poDetail.poNo,
            status: poDetail.status,
            vendor: poDetail.vendor,
            expectedDate: poDetail.expectedDate,
            amount: poDetail.amount,
            receivedPct: poDetail.receivedPct,
            items: poDetail.items.map((i) => ({
              id: i.id,
              productId: i.productId,
              qty: i.qty,
              rate: i.rate,
              received: i.received,
              product: i.product,
            })),
          }}
          onClose={() => setGrnReceiving(null)}
          onReceived={async (msg) => {
            setGrnReceiving(null);
            setBanner({ tone: "ok", text: msg });
            await refreshAll();
          }}
        />
      )}

      {/* GRN detail / QC approval modal. We resolve the row from
          the cached `grns` list so the modal can render without an
          extra fetch - the list endpoint already returns line items
          and vendor info. */}
      {viewingGrnId &&
        (() => {
          const g = grns.find((x) => x.id === viewingGrnId);
          if (!g) return null;
          return (
            <GrnDetailModal
              grn={g}
              onClose={() => setViewingGrnId(null)}
              onUpdated={async (msg) => {
                setViewingGrnId(null);
                setBanner({ tone: "ok", text: msg });
                await Promise.all([liveGrns.refetch(), livePos.refetch()]);
              }}
            />
          );
        })()}
    </div>
  );
};
