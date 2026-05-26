import { useMemo, useState } from "react";
import { AlertTriangle, Printer, Search, Wand2 } from "lucide-react";
import { Chip } from "@/components/common/Chip";
import { DataTable, type Column } from "@/components/common/DataTable";
import { EmptyState } from "@/components/common/EmptyState";
import { Input } from "@/components/common/Input";
import { Toolbar } from "@/components/common/Toolbar";
import { PackingSlipEditor } from "@/components/sales/PackingSlipEditor";
import { api, type PackingSlipRow, type PackingSlipStatus } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { dt, relative } from "@/lib/format";
import { cn } from "@/lib/cn";

const STATUS_FILTERS: { id: PackingSlipStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "packed", label: "Packed" },
  { id: "invoiced", label: "Invoiced" },
  { id: "cancelled", label: "Cancelled" },
];

const tone = (s: PackingSlipStatus): "neutral" | "primary" | "success" | "warning" | "danger" => {
  switch (s) {
    case "open":
      return "primary";
    case "packed":
      return "warning";
    case "invoiced":
      return "success";
    case "cancelled":
      return "danger";
  }
};

export const Packing = () => {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<PackingSlipStatus | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [autoBusyId, setAutoBusyId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    tone: "success" | "warning" | "danger";
    text: string;
  } | null>(null);
  const live = useApi(() => api.packingSlips({ limit: 500 }), []);
  const slips = live.data ?? [];

  const printPackingSlip = (id: string) => {
    window.open(`/print/packing-slip/${id}?print=1`, "_blank", "noopener");
  };

  const autoPack = async (row: PackingSlipRow) => {
    if (row.status !== "open") return;
    setAutoBusyId(row.id);
    setBanner(null);
    try {
      const r = await api.autoPackPackingSlip(row.id);
      const note =
        r.mismatches.length > 0
          ? ` · ${r.mismatches.length} hand-edited line${r.mismatches.length === 1 ? "" : "s"} reset`
          : "";
      setBanner({
        tone: r.mismatches.length > 0 ? "warning" : "success",
        text: `${row.packingSlipNo} packed${note}`,
      });
      void live.refetch();
    } catch (e) {
      setBanner({
        tone: "danger",
        text: `${row.packingSlipNo} · ${(e as Error).message}`,
      });
    } finally {
      setAutoBusyId(null);
      setTimeout(() => setBanner(null), 5000);
    }
  };

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return slips.filter((l) => {
      if (status !== "all" && l.status !== status) return false;
      if (!term) return true;
      return (
        l.packingSlipNo.toLowerCase().includes(term) ||
        l.salesOrder?.soNo.toLowerCase().includes(term) ||
        l.salesOrder?.customer?.name.toLowerCase().includes(term)
      );
    });
  }, [slips, q, status]);

  const cols: Column<PackingSlipRow>[] = [
    {
      key: "no",
      header: "Packing slip",
      width: "150px",
      cell: (r) => (
        <span className="font-mono text-caption font-semibold text-primary">
          {r.packingSlipNo}
        </span>
      ),
      sortable: true,
      sortValue: (r) => r.packingSlipNo,
    },
    {
      key: "so",
      header: "SO",
      width: "150px",
      cell: (r) => (
        <span className="font-mono text-caption font-semibold">{r.salesOrder?.soNo}</span>
      ),
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
      header: "Packer",
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
      key: "awb",
      header: "AWB",
      width: "150px",
      cell: (r) =>
        r.awb ? (
          <div>
            <div className="font-mono text-caption font-semibold">{r.awb}</div>
            <div className="text-caption text-ink-muted">{r.carrier}</div>
          </div>
        ) : (
          <span className="text-caption text-ink-muted">—</span>
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
      key: "actions",
      header: "Actions",
      align: "right",
      width: "150px",
      cell: (r) => (
        <div
          className="flex items-center gap-1 justify-end"
          onClick={(e) => e.stopPropagation()}
        >
          {r.status === "open" && (
            <button
              onClick={() => autoPack(r)}
              disabled={autoBusyId === r.id}
              title="Set qtyPacked = qtyPicked everywhere and lock the pack"
              className="h-7 w-7 grid place-items-center rounded-md text-ink-muted hover:text-primary hover:bg-primary-50 disabled:opacity-50"
            >
              <Wand2 size={14} />
            </button>
          )}
          <button
            onClick={() => printPackingSlip(r.id)}
            title="Open the print-friendly view"
            className="h-7 w-7 grid place-items-center rounded-md text-ink-muted hover:text-primary hover:bg-canvas"
          >
            <Printer size={14} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="h-full flex flex-col">
      <Toolbar left={<h2 className="text-h3 font-bold">Packing</h2>} right={null} />
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
          placeholder="Search by PS no., SO no., or customer…"
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
        <span className="ml-auto text-caption text-ink-muted">{filtered.length} slips</span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto bg-surface">
        {live.loading || live.error || filtered.length === 0 ? (
          <EmptyState
            loading={live.loading}
            error={live.error}
            empty={!live.loading && !live.error && filtered.length === 0}
            emptyTitle="No packing slips"
            emptyDescription="Packing slips are auto-created when a pick list is completed."
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
        <PackingSlipEditor
          packingSlipId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => void live.refetch()}
        />
      )}
    </div>
  );
};
