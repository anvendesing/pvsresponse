import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download, FileSpreadsheet, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { DataTable, type Column } from "@/components/common/DataTable";
import { Toolbar } from "@/components/common/Toolbar";
import {
  api,
  apiEnabled,
  downloadReturnTemplate,
  type CustomerReturnRow,
} from "@/lib/api";
import { inr } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ReturnImportModal } from "@/components/returns/ReturnImportModal";
import { ReturnDetail } from "@/components/returns/ReturnDetail";

const STATUS_TABS = [
  { key: "", label: "All" },
  { key: "pending_approval", label: "Pending approval" },
  { key: "processed", label: "Processed" },
  { key: "cancelled", label: "Cancelled" },
] as const;

const statusTone = (s: string) => {
  if (s === "pending_approval") return "warning" as const;
  if (s === "processed") return "success" as const;
  if (s === "cancelled") return "neutral" as const;
  return "neutral" as const;
};

const statusLabel = (s: string) => {
  if (s === "pending_approval") return "Pending approval";
  if (s === "processed") return "Processed";
  if (s === "cancelled") return "Cancelled";
  return s;
};

const COLUMNS: Column<CustomerReturnRow>[] = [
  {
    key: "returnNo",
    header: "Return #",
    cell: (r) => (
      <span className="font-mono text-primary font-semibold text-body-sm">
        {r.returnNo}
      </span>
    ),
    sortable: true,
  },
  {
    key: "customer",
    header: "Customer",
    cell: (r) => (
      <div>
        <div className="font-semibold text-body-sm">{r.customer.name}</div>
        <div className="text-caption text-ink-muted">{r.customer.code}</div>
      </div>
    ),
    sortable: true,
  },
  {
    key: "items",
    header: "Lines",
    cell: (r) => (
      <span className="tnum text-body-sm">{r.items?.length ?? "—"}</span>
    ),
  },
  {
    key: "total",
    header: "Total",
    cell: (r) => (
      <span className="tnum font-semibold text-body-sm">{inr(r.total)}</span>
    ),
    sortable: true,
  },
  {
    key: "creditNote",
    header: "Credit Note",
    cell: (r) =>
      r.creditNote ? (
        <span className="font-mono text-caption text-success">
          {r.creditNote.creditNoteNo}
        </span>
      ) : (
        <span className="text-caption text-ink-muted">—</span>
      ),
  },
  {
    key: "status",
    header: "Status",
    cell: (r) => (
      <Chip tone={statusTone(r.status)} size="sm">
        {statusLabel(r.status)}
      </Chip>
    ),
    sortable: true,
  },
  {
    key: "createdAt",
    header: "Created",
    cell: (r) => (
      <span className="text-caption text-ink-muted">
        {new Date(r.createdAt).toLocaleDateString()}
      </span>
    ),
    sortable: true,
  },
];

export const Returns = () => {
  const [searchParams] = useSearchParams();
  const focusRef = searchParams.get("focus"); // e.g. ?focus=CRN-2026-3001

  const [list, setList] = useState<CustomerReturnRow[]>([]);
  const [loading, setLoading] = useState(apiEnabled);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const didAutoOpen = useRef(false);

  const loadList = async () => {
    if (!apiEnabled) return;
    setLoading(true);
    try {
      const rows = await api.returns(statusFilter ? { status: statusFilter } : {});
      setList(rows);
      // Auto-open the return that the Approvals page deep-linked to
      if (focusRef && !didAutoOpen.current) {
        didAutoOpen.current = true;
        const match = rows.find((r) => r.returnNo === focusRef);
        if (match) setSelectedId(match.id);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const filtered = list.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.returnNo.toLowerCase().includes(q) ||
      r.customer.name.toLowerCase().includes(q) ||
      r.customer.code.toLowerCase().includes(q)
    );
  });

  const selectedReturn = list.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="h-full flex flex-col">
      <Toolbar
        left={
          <>
            <h2 className="text-h3 font-bold mr-2">Returns</h2>
            <Chip tone="neutral">{filtered.length}</Chip>
          </>
        }
        right={
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<Download size={14} />}
              onClick={() => void downloadReturnTemplate()}
              title="Download blank returns Excel template"
            >
              Template
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<FileSpreadsheet size={14} />}
              onClick={() => setImportOpen(true)}
            >
              Import from Excel
            </Button>
          </>
        }
      />

      {banner && (
        <div className="px-4 py-2 bg-success-soft border-b border-success/40 text-body-sm text-ink flex items-center gap-2">
          <span className="flex-1">{banner}</span>
          <button
            className="text-ink-muted hover:text-ink text-caption"
            onClick={() => setBanner(null)}
          >
            dismiss
          </button>
        </div>
      )}

      {/* Filter bar */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatusFilter(t.key)}
              className={cn(
                "px-3 py-1 rounded-full text-body-sm font-medium transition-colors",
                statusFilter === t.key
                  ? "bg-primary text-white"
                  : "text-ink-muted hover:bg-canvas hover:text-primary"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search return # or customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto border border-border rounded-md px-3 py-1.5 text-body-sm bg-surface focus:outline-none focus:ring-1 focus:ring-primary w-64"
        />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-ink-muted">
            <Loader2 size={28} className="animate-spin text-primary" />
            <div className="text-body font-semibold">Loading returns…</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-ink-muted">
            <RotateCcw size={32} />
            <div className="text-h3 font-semibold text-ink">No returns found</div>
            <div className="text-body max-w-md text-center">
              {search
                ? "Try a different search term."
                : "Import a returns Excel file to create your first return."}
            </div>
            {!search && (
              <Button
                variant="outline"
                size="sm"
                icon={<FileSpreadsheet size={14} />}
                onClick={() => setImportOpen(true)}
              >
                Import from Excel
              </Button>
            )}
          </div>
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowClick={(r) => setSelectedId(r.id)}
          />
        )}
      </div>

      {importOpen && (
        <ReturnImportModal
          onClose={() => setImportOpen(false)}
          onCreated={(returnId, returnNo) => {
            setBanner(`Return ${returnNo} created. Sent for approval.`);
            void loadList();
            setSelectedId(returnId);
            setImportOpen(false);
          }}
        />
      )}

      {selectedId && (
        <ReturnDetail
          returnId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => void loadList()}
        />
      )}
    </div>
  );
};
