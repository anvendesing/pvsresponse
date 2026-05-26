import { useMemo, useState } from "react";
import { AlertTriangle, Printer, Search, Wand2 } from "lucide-react";
import { Chip } from "@/components/common/Chip";
import { DataTable, type Column } from "@/components/common/DataTable";
import { EmptyState } from "@/components/common/EmptyState";
import { Input } from "@/components/common/Input";
import { Toolbar } from "@/components/common/Toolbar";
import { PickListEditor } from "@/components/sales/PickListEditor";
import { api, ApiError, type PickListRow, type PickListStatus } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { dt, relative } from "@/lib/format";
import { cn } from "@/lib/cn";

const STATUS_FILTERS: { id: PickListStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "picking", label: "In progress" },
  { id: "picked", label: "Picked" },
  { id: "cancelled", label: "Cancelled" },
];

const tone = (s: PickListStatus): "neutral" | "primary" | "success" | "danger" => {
  switch (s) {
    case "draft":
      return "neutral";
    case "picking":
      return "primary";
    case "picked":
      return "success";
    case "cancelled":
      return "danger";
  }
};

export const Picking = () => {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<PickListStatus | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  // Per-row busy flag for the inline auto-pick button so the user
  // can't double-click while the request is in flight, and so the
  // button can show a spinner state.
  const [autoBusyId, setAutoBusyId] = useState<string | null>(null);
  // Toast-style banner shown after an inline auto-pick succeeds /
  // fails. Cleared after 5 seconds so the table state stays clean.
  const [banner, setBanner] = useState<{
    tone: "success" | "warning" | "danger";
    text: string;
  } | null>(null);
  const live = useApi(() => api.pickLists({ limit: 500 }), []);
  const lists = live.data ?? [];

  const printPickList = (id: string) => {
    window.open(`/print/pick-list/${id}?print=1`, "_blank", "noopener");
  };

  const autoPick = async (row: PickListRow) => {
    if (!["draft", "picking"].includes(row.status)) return;
    setAutoBusyId(row.id);
    setBanner(null);
    try {
      const r = await api.autoPickList(row.id);
      const shortNote =
        r.shortfalls.length > 0
          ? ` · ${r.shortfalls.length} line${r.shortfalls.length === 1 ? "" : "s"} short`
          : "";
      setBanner({
        tone: r.shortfalls.length > 0 ? "warning" : "success",
        text: `${row.pickListNo} → ${r.packingSlip.packingSlipNo} packing slip${shortNote}`,
      });
      void live.refetch();
    } catch (e) {
      // 409 auto_pick_partial means stock fell short - open the drawer
      // so the operator sees the per-line details and can either accept
      // the partial pick or amend bin counts.
      if (e instanceof ApiError && e.status === 409) {
        const det = e.details as { code?: string } | undefined;
        if (det?.code === "auto_pick_partial") {
          setBanner({
            tone: "warning",
            text: `${row.pickListNo} · stock short, opening details...`,
          });
          setOpenId(row.id);
          return;
        }
      }
      setBanner({
        tone: "danger",
        text: `${row.pickListNo} · ${(e as Error).message}`,
      });
    } finally {
      setAutoBusyId(null);
      setTimeout(() => setBanner(null), 5000);
    }
  };

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return lists.filter((l) => {
      if (status !== "all" && l.status !== status) return false;
      if (!term) return true;
      return (
        l.pickListNo.toLowerCase().includes(term) ||
        l.salesOrder?.soNo.toLowerCase().includes(term) ||
        l.salesOrder?.customer?.name.toLowerCase().includes(term)
      );
    });
  }, [lists, q, status]);

  const cols: Column<PickListRow>[] = [
    {
      key: "no",
      header: "Pick list",
      width: "150px",
      cell: (r) => (
        <span className="font-mono text-caption font-semibold text-primary">{r.pickListNo}</span>
      ),
      sortable: true,
      sortValue: (r) => r.pickListNo,
    },
    {
      key: "so",
      header: "Sales Order",
      width: "150px",
      cell: (r) => (
        <span className="font-mono text-caption font-semibold">{r.salesOrder?.soNo}</span>
      ),
      sortable: true,
      sortValue: (r) => r.salesOrder?.soNo ?? "",
    },
    {
      key: "customer",
      header: "Customer",
      cell: (r) => <span className="font-semibold">{r.salesOrder?.customer?.name}</span>,
    },
    {
      key: "lines",
      header: "Lines",
      align: "center",
      width: "70px",
      cell: (r) => <span className="tnum">{r._count?.items ?? r.items?.length ?? 0}</span>,
    },
    {
      key: "assignee",
      header: "Claimed by",
      width: "150px",
      cell: (r) =>
        r.assignedTo ? (
          <div>
            <div className="text-body-sm font-semibold">{r.assignedTo.name}</div>
            <div className="text-caption text-ink-muted">@{r.assignedTo.username}</div>
          </div>
        ) : (
          <span className="text-caption text-ink-muted italic">unclaimed</span>
        ),
      sortable: true,
      sortValue: (r) => r.assignedTo?.name ?? "zzz",
    },
    {
      key: "status",
      header: "Status",
      width: "120px",
      cell: (r) => (
        <Chip tone={tone(r.status)} size="sm" className="capitalize">
          {r.status}
        </Chip>
      ),
    },
    {
      key: "created",
      header: "Created",
      width: "160px",
      cell: (r) => (
        <div>
          <div className="text-body-sm">{dt(r.createdAt)}</div>
          <div className="text-caption text-ink-muted">{relative(r.createdAt)}</div>
        </div>
      ),
      sortable: true,
      sortValue: (r) => r.createdAt,
    },
    {
      key: "picked",
      header: "Picked at",
      width: "140px",
      cell: (r) =>
        r.pickedAt ? (
          <span className="text-caption">{dt(r.pickedAt)}</span>
        ) : (
          <span className="text-caption text-ink-muted">—</span>
        ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      width: "150px",
      cell: (r) => {
        const open = r.status === "draft" || r.status === "picking";
        return (
          <div
            className="flex items-center gap-1 justify-end"
            onClick={(e) => e.stopPropagation()}
          >
            {open && (
              <button
                onClick={() => autoPick(r)}
                disabled={autoBusyId === r.id}
                title="Fill all lines and complete in one click"
                className="h-7 w-7 grid place-items-center rounded-md text-ink-muted hover:text-primary hover:bg-primary-50 disabled:opacity-50"
              >
                <Wand2 size={14} />
              </button>
            )}
            <button
              onClick={() => printPickList(r.id)}
              title="Open the print-friendly view"
              className="h-7 w-7 grid place-items-center rounded-md text-ink-muted hover:text-primary hover:bg-canvas"
            >
              <Printer size={14} />
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="h-full flex flex-col">
      <Toolbar
        left={<h2 className="text-h3 font-bold">Picking</h2>}
        right={
          <span className="text-caption text-ink-muted">
            Pick lists are created from Sales Orders.
          </span>
        }
      />
      {banner && (
        <div
          className={cn(
            "px-4 py-2 text-body-sm border-b flex items-center gap-2",
            banner.tone === "success" && "bg-success-soft text-success border-success",
            banner.tone === "warning" && "bg-warning-soft text-ink border-warning",
            banner.tone === "danger" && "bg-danger-soft text-danger border-danger"
          )}
        >
          {banner.tone === "warning" && <AlertTriangle size={14} />}
          {banner.text}
        </div>
      )}
      <div className="px-4 py-2 bg-surface border-b border-border flex flex-wrap items-center gap-2">
        <Input
          size="sm"
          iconLeft={<Search size={14} />}
          placeholder="Search by PL no., SO no., or customer…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="!h-8 max-w-xs"
        />
        <div className="flex items-center gap-1 ml-2">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.id}
              onClick={() => setStatus(s.id)}
              className={cn(
                "h-7 px-3 rounded-md text-caption font-semibold transition-colors capitalize",
                status === s.id
                  ? "bg-primary text-white"
                  : "bg-canvas text-ink-muted hover:text-primary"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-caption text-ink-muted">
          {filtered.length} pick lists
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto bg-surface">
        {live.loading || live.error || filtered.length === 0 ? (
          <EmptyState
            loading={live.loading}
            error={live.error}
            empty={!live.loading && !live.error && filtered.length === 0}
            emptyTitle="No pick lists"
            emptyDescription="Open a Sales Order and click Start picking to create one."
            onRetry={live.refetch}
          />
        ) : (
          <DataTable
            rows={filtered}
            columns={cols}
            rowKey={(r) => r.id}
            onRowClick={(r) => setOpenId(r.id)}
          />
        )}
      </div>

      {openId && (
        <PickListEditor
          pickListId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => void live.refetch()}
        />
      )}
    </div>
  );
};
