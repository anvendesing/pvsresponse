import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../../lib/api";

// =====================================================================
// /m/tasks
// =====================================================================
// Three segmented sections (Pick, Pack, Transfer), each with Mine / Available.

interface TaskRow {
  id: string;
  pickListNo?: string;
  packingSlipNo?: string;
  // Transfer order fields
  transferNo?: string;
  kind?: string;
  fromWarehouse?: { code: string; name: string };
  toWarehouse?: { code: string; name: string };
  productionOrder?: { orderNo: string } | null;
  status: string;
  assignedToId?: string | null;
  claimedAt?: string | null;
  salesOrder?: {
    soNo: string;
    customer?: { name?: string; code?: string; city?: string | null };
  };
  _count?: { items: number };
}

interface TasksResponse {
  pickClaimed: TaskRow[];
  pickAvailable: TaskRow[];
  packClaimed: TaskRow[];
  packAvailable: TaskRow[];
  transferClaimed: TaskRow[];
  transferAvailable: TaskRow[];
  counts: {
    pickClaimed: number;
    pickAvailable: number;
    packClaimed: number;
    packAvailable: number;
    transferClaimed: number;
    transferAvailable: number;
  };
}

export const MobileTasks = () => {
  const [tab, setTab] = useState<"pick" | "pack" | "transfer" | "more">("pick");
  const [data, setData] = useState<TasksResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tasks = (await api.myTasks()) as unknown as TasksResponse;
      setData(tasks);
    } catch (err) {
      setError((err as Error).message ?? "Could not load tasks.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const claim = async (id: string, kind: "pick" | "pack" | "transfer") => {
    setClaiming(id);
    try {
      if (kind === "pick") await api.claimPickList(id);
      else if (kind === "pack") await api.claimPackingSlip(id);
      else await api.claimTransferOrder(id);
      await refresh();
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 409
          ? "Someone else just claimed this. Refreshing the list."
          : (err as Error).message;
      setError(message);
      await refresh();
    } finally {
      setClaiming(null);
    }
  };

  const mine =
    tab === "pick"
      ? data?.pickClaimed ?? []
      : tab === "pack"
      ? data?.packClaimed ?? []
      : tab === "transfer"
      ? data?.transferClaimed ?? []
      : [];
  const available =
    tab === "pick"
      ? data?.pickAvailable ?? []
      : tab === "pack"
      ? data?.packAvailable ?? []
      : tab === "transfer"
      ? data?.transferAvailable ?? []
      : [];

  const transferTotal =
    (data?.counts.transferClaimed ?? 0) + (data?.counts.transferAvailable ?? 0);

  return (
    <div className="px-4 pt-4">
      <div className="mb-3 flex rounded-2xl bg-slate-200 p-1 gap-0.5">
        <SegmentBtn
          active={tab === "pick"}
          onClick={() => setTab("pick")}
          label={`Pick (${(data?.counts.pickClaimed ?? 0) + (data?.counts.pickAvailable ?? 0)})`}
        />
        <SegmentBtn
          active={tab === "pack"}
          onClick={() => setTab("pack")}
          label={`Pack (${(data?.counts.packClaimed ?? 0) + (data?.counts.packAvailable ?? 0)})`}
        />
        <SegmentBtn
          active={tab === "transfer"}
          onClick={() => setTab("transfer")}
          label={`Move (${transferTotal})`}
        />
        <SegmentBtn
          active={tab === "more"}
          onClick={() => setTab("more")}
          label="More"
        />
      </div>

      {error && (
        <div className="mb-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </div>
      )}

      {tab !== "more" && (
        <>
          <Section title="My tasks" empty="Nothing claimed - grab one below.">
            {mine.map((t) => (
              <TaskCard key={t.id} task={t} kind={tab} mine />
            ))}
          </Section>

          <Section
            title="Available queue"
            empty="The queue is clear. Nice work."
          >
            {available.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                kind={tab}
                mine={false}
                claiming={claiming === t.id}
                onClaim={() => claim(t.id, tab)}
              />
            ))}
          </Section>
        </>
      )}

      {/* More tab: shortcuts to GRN, Count, Returns */}
      {tab === "more" && (
        <div className="space-y-2 mb-4">
          <QuickLink
            to="/m/grn"
            icon="📦"
            title="Goods Receipt (GRN)"
            desc="Receive stock against open purchase orders"
          />
          <QuickLink
            to="/m/grn-qc"
            icon="✓"
            title="GRN QC approval"
            desc="Inspect and approve pending goods receipts"
          />
          <QuickLink
            to="/m/count"
            icon="🔢"
            title="Cycle Count / Recount"
            desc="Scan a bin to recount, reassign, or adjust stock"
          />
          <QuickLink
            to="/m/bulk-zone"
            icon="📋"
            title="Bulk zone stock update"
            desc="Update barcode and qty for all bins in a zone at once"
          />
          <QuickLink
            to="/m/bulk-capture"
            icon="🗂️"
            title="Bulk capture - Zone PR"
            desc="Scan a Zone PR bin and count for every Stock Room variant"
          />
          <QuickLink
            to="/m/returns"
            icon="↩️"
            title="Customer Returns"
            desc="Review and decide pending return lines"
          />
        </div>
      )}

      {tab !== "more" && (
        <button
          type="button"
          onClick={() => void refresh()}
          className="my-4 w-full rounded-xl border border-slate-300 bg-white py-2 text-sm font-medium text-slate-600"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      )}
    </div>
  );
};

const SegmentBtn = ({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={[
      "flex-1 rounded-xl py-2 text-sm font-semibold transition",
      active
        ? "bg-white text-[#003087] shadow-sm"
        : "text-slate-600",
    ].join(" ")}
  >
    {label}
  </button>
);

const Section = ({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) => {
  const arr = Array.isArray(children) ? children : [children];
  const filtered = arr.filter(Boolean);
  return (
    <div className="mb-5">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </h2>
      {filtered.length === 0 ? (
        <div className="rounded-xl bg-white px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">
          {empty}
        </div>
      ) : (
        <div className="space-y-2">{filtered}</div>
      )}
    </div>
  );
};

const KIND_BADGE: Record<string, string> = {
  putaway: "bg-purple-100 text-purple-800",
  replenishment: "bg-orange-100 text-orange-800",
  manual: "bg-slate-100 text-slate-700",
};

const KIND_LABEL: Record<string, string> = {
  putaway: "Putaway",
  replenishment: "Replenish",
  manual: "Manual",
};

const TaskCard = ({
  task,
  kind,
  mine,
  claiming,
  onClaim,
}: {
  task: TaskRow;
  kind: "pick" | "pack" | "transfer";
  mine: boolean;
  claiming?: boolean;
  onClaim?: () => void;
}) => {
  if (kind === "transfer") {
    const detailHref = `/m/transfers/${task.id}`;
    const toKindBadge = KIND_BADGE[task.kind ?? "manual"] ?? "bg-slate-100 text-slate-700";
    const toKindLabel = KIND_LABEL[task.kind ?? "manual"] ?? "Transfer";
    const items = task._count?.items ?? 0;
    return (
      <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold text-[#003087]">
                {task.transferNo ?? task.id.slice(0, 8)}
              </span>
              <span className={["rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", toKindBadge].join(" ")}>
                {toKindLabel}
              </span>
              <StatusPill status={task.status} />
            </div>
            <div className="mt-1 text-sm font-medium text-slate-900 truncate">
              {task.fromWarehouse?.code ?? "?"} → {task.toWarehouse?.code ?? "?"}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {items} item{items === 1 ? "" : "s"}
              {task.productionOrder ? ` · MO ${task.productionOrder.orderNo}` : ""}
            </div>
          </div>
          {mine ? (
            <a
              href={detailHref}
              className="flex-shrink-0 rounded-xl bg-[#003087] px-4 py-2 text-sm font-semibold text-white"
            >
              Open
            </a>
          ) : (
            <button
              type="button"
              disabled={claiming}
              onClick={onClaim}
              className="flex-shrink-0 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {claiming ? "…" : "Claim"}
            </button>
          )}
        </div>
      </div>
    );
  }

  const docNo = kind === "pick" ? task.pickListNo : task.packingSlipNo;
  const detailHref = kind === "pick" ? `/m/picks/${task.id}` : `/m/packs/${task.id}`;
  const customer = task.salesOrder?.customer?.name ?? "—";
  const so = task.salesOrder?.soNo ?? "";
  const items = task._count?.items ?? 0;
  return (
    <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-[#003087]">
              {docNo}
            </span>
            <StatusPill status={task.status} />
          </div>
          <div className="mt-1 truncate text-sm font-medium text-slate-900">
            {customer}
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-500">
            SO {so} · {items} line{items === 1 ? "" : "s"}
          </div>
        </div>
        {mine ? (
          <Link
            to={detailHref}
            className="flex-shrink-0 rounded-xl bg-[#003087] px-4 py-2 text-sm font-semibold text-white"
          >
            Open
          </Link>
        ) : (
          <button
            type="button"
            disabled={claiming}
            onClick={onClaim}
            className="flex-shrink-0 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {claiming ? "…" : "Claim"}
          </button>
        )}
      </div>
    </div>
  );
};

const QuickLink = ({
  to,
  icon,
  title,
  desc,
}: {
  to: string;
  icon: string;
  title: string;
  desc: string;
}) => (
  <Link
    to={to}
    className="flex items-center gap-4 rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200 shadow-sm"
  >
    <span className="text-2xl">{icon}</span>
    <div className="min-w-0 flex-1">
      <div className="text-sm font-semibold text-slate-800">{title}</div>
      <div className="text-xs text-slate-500 truncate">{desc}</div>
    </div>
    <span className="text-slate-400 text-lg">›</span>
  </Link>
);

const StatusPill = ({ status }: { status: string }) => {
  const map: Record<string, string> = {
    draft: "bg-slate-100 text-slate-700",
    picking: "bg-amber-100 text-amber-800",
    picked: "bg-emerald-100 text-emerald-800",
    open: "bg-amber-100 text-amber-800",
    packed: "bg-emerald-100 text-emerald-800",
    cancelled: "bg-red-100 text-red-700",
  };
  return (
    <span
      className={[
        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        map[status] ?? "bg-slate-100 text-slate-700",
      ].join(" ")}
    >
      {status}
    </span>
  );
};
