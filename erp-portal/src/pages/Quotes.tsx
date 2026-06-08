import { useMemo, useState } from "react";
import { FileSpreadsheet, Filter, Plus, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { DataTable, type Column } from "@/components/common/DataTable";
import { EmptyState } from "@/components/common/EmptyState";
import { Input } from "@/components/common/Input";
import { Toolbar } from "@/components/common/Toolbar";
import { QuoteEditor } from "@/components/sales/QuoteEditor";
import { ShareQuoteMenu } from "@/components/sales/ShareQuoteMenu";
import { BulkOrderImportModal } from "@/components/sales/BulkOrderImportModal";
import {
  api,
  type AcceptQuoteResponse,
  type CustomerRow,
  type QuoteRow,
  type QuoteStatus,
} from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { inr, dd, relative } from "@/lib/format";
import { cn } from "@/lib/cn";

const STATUS_FILTERS: { id: QuoteStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "submitted", label: "Submitted" },
  { id: "accepted", label: "Accepted" },
  { id: "converted", label: "Converted" },
  { id: "expired", label: "Expired" },
  { id: "rejected", label: "Rejected" },
];

const statusTone = (s: QuoteStatus): "neutral" | "primary" | "success" | "warning" | "danger" => {
  switch (s) {
    case "draft":
      return "neutral";
    case "submitted":
      return "primary";
    case "accepted":
      return "success";
    case "converted":
      return "success";
    case "rejected":
      return "danger";
    case "expired":
      return "warning";
  }
};

export const Quotes = () => {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<QuoteStatus | "all">("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<QuoteRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  // When the credit-hold flow returns 202 we attach the approvalId so the
  // banner can render a "Go to approvals" deep-link instead of a plain string.
  const [bannerAction, setBannerAction] = useState<{
    label: string;
    onClick: () => void;
  } | null>(null);
  const [bannerTone, setBannerTone] = useState<"info" | "warning" | "success">(
    "info"
  );

  const liveQuotes = useApi(() => api.quotes({ limit: 500 }), []);
  const liveCustomers = useApi<CustomerRow[]>(() => api.customers(), []);
  const liveProducts = useApi(() => api.products({ limit: 500 }), []);

  const quotes = liveQuotes.data ?? [];
  const customers = liveCustomers.data ?? [];
  const products = liveProducts.data ?? [];

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return quotes.filter((qt) => {
      if (status !== "all" && qt.status !== status) return false;
      if (!term) return true;
      return (
        qt.quoteNo.toLowerCase().includes(term) ||
        qt.customer?.name.toLowerCase().includes(term)
      );
    });
  }, [quotes, q, status]);

  const openCreate = () => {
    setEditorMode("create");
    setEditing(null);
    setEditorOpen(true);
  };

  const openEdit = async (row: QuoteRow) => {
    try {
      const fresh = await api.quote(row.id);
      setEditing(fresh);
      setEditorMode("edit");
      setEditorOpen(true);
    } catch (e) {
      setBanner((e as Error).message);
    }
  };

  const showBanner = (
    msg: string,
    tone: "info" | "warning" | "success" = "info",
    action?: { label: string; onClick: () => void } | null
  ) => {
    setBanner(msg);
    setBannerTone(tone);
    setBannerAction(action ?? null);
  };

  const dismissBanner = () => {
    setBanner(null);
    setBannerAction(null);
  };

  const onSaved = (saved: QuoteRow) => {
    const submitted = saved.status === "submitted";
    showBanner(
      submitted
        ? `Submitted ${saved.quoteNo} — find it in the list below.`
        : `Saved ${saved.quoteNo} (rev ${saved.revision}, ${saved.status}).`,
      submitted ? "success" : "info"
    );
    void liveQuotes.refetch();
  };

  const goToApproval = (approvalId?: string) => {
    navigate(approvalId ? `/approvals?id=${approvalId}` : "/approvals");
  };

  const onAccepted = (resp: AcceptQuoteResponse) => {
    if (resp.creditHold) {
      showBanner(
        `Quote accepted — Sales Order is ON HOLD pending credit-limit approval${
          resp.approvalId ? ` (#${resp.approvalId.slice(-6)})` : ""
        }. ${resp.message ?? ""}`.trim(),
        "warning",
        {
          label: "Go to approvals",
          onClick: () => goToApproval(resp.approvalId),
        }
      );
    } else if (resp.alreadyConverted && resp.salesOrder) {
      showBanner(`Already converted to ${resp.salesOrder.soNo}.`, "info", {
        label: "Open Sales Order",
        onClick: () => navigate(`/sales-orders?id=${resp.salesOrder!.id}`),
      });
    } else if (resp.soNo) {
      showBanner(
        `Sales Order ${resp.soNo} created. Total ${inr(resp.total ?? 0)}.`,
        "success",
        {
          label: "Open Sales Order",
          onClick: () => navigate(`/sales-orders?id=${resp.id}`),
        }
      );
    }
    void liveQuotes.refetch();
  };

  const cols: Column<QuoteRow>[] = [
    {
      key: "no",
      header: "Quote",
      width: "150px",
      cell: (r) => (
        <div>
          <div className="font-mono text-caption font-semibold text-primary">{r.quoteNo}</div>
          {r.revision > 1 && (
            <div className="text-caption text-ink-muted">rev {r.revision}</div>
          )}
        </div>
      ),
      sortable: true,
      sortValue: (r) => r.quoteNo,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (r) => (
        <div>
          <div className="font-semibold">{r.customer?.name}</div>
          <div className="text-caption text-ink-muted">{r.customer?.city ?? ""}</div>
        </div>
      ),
      sortable: true,
      sortValue: (r) => r.customer?.name ?? "",
    },
    {
      key: "lines",
      header: "Lines",
      align: "center",
      width: "70px",
      cell: (r) => <span className="tnum">{r._count?.items ?? r.items?.length ?? 0}</span>,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      width: "130px",
      cell: (r) => <span className="font-bold tnum">{inr(r.total)}</span>,
      sortable: true,
      sortValue: (r) => r.total,
    },
    {
      key: "validity",
      header: "Valid until",
      width: "180px",
      cell: (r) => {
        const days = Math.ceil(
          (new Date(r.validUntil).getTime() - Date.now()) / 86400000
        );
        return (
          <div>
            <div className="text-body-sm">{dd(r.validUntil)}</div>
            <div
              className={cn(
                "text-caption",
                days < 0 ? "text-danger" : days < 7 ? "text-warning" : "text-ink-muted"
              )}
            >
              {days < 0 ? `${-days}d ago` : `${days}d left`}
            </div>
          </div>
        );
      },
      sortable: true,
      sortValue: (r) => r.validUntil,
    },
    {
      key: "status",
      header: "Status",
      width: "170px",
      cell: (r) => (
        <div className="flex flex-col gap-1 items-start">
          <Chip tone={statusTone(r.status)} size="sm" className="capitalize">
            {r.status}
          </Chip>
          {/*
            Visual cue for a quote whose Sales Order is parked on a
            credit-limit approval. The quote list endpoint doesn't include
            pendingApproval, but the combination accepted + no SO is a
            reliable proxy.
          */}
          {r.status === "accepted" && !r.convertedSalesOrderId && (
            <Chip tone="warning" size="sm" className="text-caption">
              SO on hold
            </Chip>
          )}
          {r.status === "converted" && r.convertedSalesOrderId && (
            <Chip tone="success" size="sm" className="text-caption">
              SO created
            </Chip>
          )}
        </div>
      ),
    },
    {
      key: "updated",
      header: "Updated",
      width: "120px",
      cell: (r) => (
        <span className="text-caption text-ink-muted">{relative(r.updatedAt)}</span>
      ),
    },
    {
      key: "share",
      header: "",
      width: "100px",
      align: "right",
      cell: (r) =>
        r.status === "draft" ? null : (
          <div onClick={(e) => e.stopPropagation()}>
            <ShareQuoteMenu quote={r} size="sm" />
          </div>
        ),
    },
  ];

  const initialLoading = liveQuotes.loading || liveCustomers.loading || liveProducts.loading;
  const initialError = liveQuotes.error ?? liveCustomers.error ?? liveProducts.error;

  return (
    <div className="h-full flex flex-col">
      <Toolbar
        left={<h2 className="text-h3 font-bold">Quotes</h2>}
        right={
          <>
            <Button variant="outline" size="sm" icon={<Filter size={14} />}>
              Filters
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<FileSpreadsheet size={14} />}
              onClick={() => setImportOpen(true)}
              title="Import a bulk order Excel to create a quote"
            >
              Import from Excel
            </Button>
            <Button size="sm" icon={<Plus size={14} />} onClick={openCreate}>
              New quote
            </Button>
          </>
        }
      />

      <div className="px-4 py-2 bg-surface border-b border-border flex flex-wrap items-center gap-2">
        <Input
          size="sm"
          iconLeft={<Search size={14} />}
          placeholder="Search by quote no. or customer…"
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
        <span className="ml-auto text-caption text-ink-muted">{filtered.length} quotes</span>
      </div>

      {banner && (
        <div
          className={cn(
            "px-4 py-2 border-b text-ink text-body-sm flex items-center gap-2",
            bannerTone === "warning"
              ? "bg-warning-soft border-warning/40"
              : bannerTone === "success"
                ? "bg-success-soft border-success/40"
                : "bg-primary-50 border-primary/20"
          )}
        >
          <span className="flex-1">{banner}</span>
          {bannerAction && (
            <Button size="sm" variant="outline" onClick={bannerAction.onClick}>
              {bannerAction.label}
            </Button>
          )}
          <button
            onClick={dismissBanner}
            className="text-ink-muted hover:text-ink text-caption"
          >
            dismiss
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto bg-surface">
        {initialLoading || initialError || filtered.length === 0 ? (
          <EmptyState
            loading={initialLoading}
            error={initialError}
            empty={!initialLoading && !initialError && filtered.length === 0}
            emptyTitle="No quotes match the filters"
            emptyDescription="Create a new quote to get started."
            onRetry={() => {
              liveQuotes.refetch();
              liveCustomers.refetch();
              liveProducts.refetch();
            }}
          />
        ) : (
          <DataTable
            rows={filtered}
            columns={cols}
            rowKey={(r) => r.id}
            onRowClick={(r) => void openEdit(r)}
          />
        )}
      </div>

      <QuoteEditor
        open={editorOpen}
        mode={editorMode}
        quote={editing}
        customers={customers}
        products={products}
        onClose={() => setEditorOpen(false)}
        onSaved={onSaved}
        onAccepted={onAccepted}
        onNavigateToApprovals={(approvalId) => {
          setEditorOpen(false);
          goToApproval(approvalId);
        }}
        onDeleted={(deleted) => {
          showBanner(`Deleted draft ${deleted.quoteNo}.`, "info");
          void liveQuotes.refetch();
        }}
      />

      {importOpen && (
        <BulkOrderImportModal
          onClose={() => setImportOpen(false)}
          onCreated={(quoteId, quoteNo) => {
            showBanner(
              `Quote ${quoteNo} created from Excel import (draft). Open it and click Convert → Sales Order.`,
              "success"
            );
            void liveQuotes.refetch();
            void quoteId;
          }}
        />
      )}
    </div>
  );
};
