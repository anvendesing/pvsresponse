// Multi-container packing reports.
//
// Four read-only views meant for floor supervisors + customer-care:
//   1. Pack manifest  — pick a packing slip, see container-by-container
//                       breakdown. Useful right before sealing the trip
//                       and printable for the customer.
//   2. Item history   — paste a SKU / barcode, see the most recent
//                       containers it shipped in (which slip, which
//                       trip, which dispatch). Powers traceability when
//                       a buyer reports missing / damaged items.
//   3. Trip manifest  — pick a trip, see every container across every
//                       stop along with totals. Printed by the loader
//                       before departure.
//   4. Pack throughput — daily slips / containers / weight chart for
//                       the last N days. Productivity widget.
//
// Each tab supports a CSV download via the `?format=csv` query — the
// download is triggered through `downloadFile` so the bearer token
// stays in the request headers (URLs are tokenless).

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Boxes,
  Download,
  History,
  PackageOpen,
  Search,
  TrendingUp,
  Truck,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { EmptyState } from "@/components/common/EmptyState";
import { Input } from "@/components/common/Input";
import { Kpi } from "@/components/common/Kpi";
import { Toolbar } from "@/components/common/Toolbar";
import { api, downloadFile, type PackingSlipRow, type TripRow } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { cn } from "@/lib/cn";

type TabId = "pack-manifest" | "item-history" | "trip-manifest" | "throughput";

const TABS: { id: TabId; label: string; icon: typeof Boxes }[] = [
  { id: "pack-manifest", label: "Pack manifest", icon: PackageOpen },
  { id: "item-history", label: "Item history", icon: History },
  { id: "trip-manifest", label: "Trip manifest", icon: Truck },
  { id: "throughput", label: "Pack throughput", icon: TrendingUp },
];

const fmtKg = (n: number | null | undefined) =>
  n == null ? "—" : `${n.toFixed(2)} kg`;

export const ContainerReports = () => {
  // Deep-links from PackingSlipEditor / Transport / item detail pages
  // pre-select a tab + filter. The page falls back to the first tab if
  // no query params are present.
  const [params] = useSearchParams();
  const initial = (params.get("tab") as TabId) ?? "pack-manifest";
  const [tab, setTab] = useState<TabId>(
    TABS.some((t) => t.id === initial) ? initial : "pack-manifest"
  );
  const initialSlip = params.get("slip") ?? null;
  const initialTrip = params.get("trip") ?? null;
  const initialBarcode = params.get("barcode") ?? "";

  // Switch to the right tab when the deep-link includes a specific
  // selector — e.g. /reports/containers?trip=... should land on the
  // Trip manifest tab.
  useEffect(() => {
    if (initialTrip) setTab("trip-manifest");
    else if (initialSlip) setTab("pack-manifest");
    else if (initialBarcode) setTab("item-history");
    // Only react to the deep-link on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-full flex flex-col">
      <Toolbar
        left={
          <div className="flex items-center gap-2">
            <Boxes size={18} className="text-primary" />
            <h2 className="text-h3 font-bold">Container reports</h2>
          </div>
        }
      />

      <div className="border-b border-border bg-surface px-4 flex items-center gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "h-10 px-3 inline-flex items-center gap-1.5 text-body-sm whitespace-nowrap border-b-2 -mb-px transition-colors",
                active
                  ? "border-primary text-primary font-semibold"
                  : "border-transparent text-ink-muted hover:text-ink"
              )}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto bg-canvas p-4">
        {tab === "pack-manifest" && <PackManifestTab initialSlipId={initialSlip} />}
        {tab === "item-history" && <ItemHistoryTab initialBarcode={initialBarcode} />}
        {tab === "trip-manifest" && <TripManifestTab initialTripId={initialTrip} />}
        {tab === "throughput" && <ThroughputTab />}
      </div>
    </div>
  );
};

// =====================================================================
// 1. Pack manifest
// =====================================================================
const PackManifestTab = ({ initialSlipId }: { initialSlipId?: string | null }) => {
  const [slipId, setSlipId] = useState<string | null>(initialSlipId ?? null);
  const slipsQ = useApi(
    () => api.packingSlips({ status: undefined, limit: 100 }),
    []
  );
  const reportQ = useApi(
    () => (slipId ? api.packManifest(slipId) : Promise.resolve(null)),
    [slipId]
  );

  useEffect(() => {
    if (!slipId && slipsQ.data && slipsQ.data.length > 0) {
      setSlipId(slipsQ.data[0].id);
    }
  }, [slipId, slipsQ.data]);

  return (
    <div className="grid grid-cols-12 gap-4">
      <Card title="Packing slips" className="col-span-3" bodyClassName="!p-0">
        <div className="max-h-[70vh] overflow-y-auto divide-y divide-border">
          {slipsQ.loading && (
            <div className="p-3 text-body-sm text-ink-muted">Loading…</div>
          )}
          {(slipsQ.data ?? []).map((s) => (
            <button
              key={s.id}
              onClick={() => setSlipId(s.id)}
              className={cn(
                "w-full text-left px-3 py-2 hover:bg-canvas transition-colors flex flex-col",
                slipId === s.id && "bg-primary/5"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-body-sm font-semibold">
                  {s.packingSlipNo}
                </span>
                <Chip tone={slipStatusTone(s.status)}>{s.status}</Chip>
              </div>
              <div className="text-caption text-ink-muted truncate">
                {(s as PackingSlipRow & { salesOrder?: { soNo: string } }).salesOrder
                  ?.soNo ?? ""}
              </div>
            </button>
          ))}
        </div>
      </Card>

      <div className="col-span-9 space-y-4">
        {reportQ.loading && <EmptyState loading />}
        {reportQ.error && (
          <EmptyState error={reportQ.error} onRetry={reportQ.refetch} />
        )}
        {!reportQ.loading && !reportQ.data && (
          <div className="text-body-sm text-ink-muted">Select a packing slip.</div>
        )}
        {reportQ.data && (
          <>
            <div className="grid grid-cols-4 gap-3">
              <Kpi
                label="Containers"
                value={`${reportQ.data.totals.containerCount}`}
                hint={`${reportQ.data.totals.sealedCount} sealed`}
              />
              <Kpi
                label="Units packed"
                value={`${reportQ.data.totals.unitCount}`}
              />
              <Kpi
                label="Est. weight"
                value={fmtKg(reportQ.data.totals.estWeightKg)}
              />
              <Kpi
                label="Actual weight"
                value={fmtKg(reportQ.data.totals.actualWeightKg)}
              />
            </div>

            <Card
              title={
                <div className="flex items-center gap-2">
                  <span>{reportQ.data.slip.packingSlipNo}</span>
                  <Chip tone={slipStatusTone(reportQ.data.slip.status)}>
                    {reportQ.data.slip.status}
                  </Chip>
                </div>
              }
              subtitle={
                reportQ.data.salesOrder
                  ? `${reportQ.data.salesOrder.soNo} · ${reportQ.data.salesOrder.customer?.name ?? ""}`
                  : undefined
              }
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Download size={14} />}
                  onClick={() =>
                    downloadFile(
                      `/reports/pack-manifest/${reportQ.data!.slip.id}`,
                      `pack-manifest-${reportQ.data!.slip.packingSlipNo}.csv`,
                      { query: { format: "csv" } }
                    )
                  }
                >
                  CSV
                </Button>
              }
            >
              {reportQ.data.containers.length === 0 && (
                <div className="text-body-sm text-ink-muted">
                  This slip has no containers yet.
                </div>
              )}
              <div className="space-y-3">
                {reportQ.data.containers.map((c) => (
                  <div
                    key={c.id}
                    className="border border-border rounded-lg overflow-hidden"
                  >
                    <div className="bg-canvas px-3 py-2 flex items-center gap-2 border-b border-border">
                      <span className="font-mono font-bold text-body">
                        {c.label}
                      </span>
                      <span className="text-caption text-ink-muted font-mono">
                        {c.code}
                      </span>
                      {c.containerType && (
                        <Chip tone="neutral">{c.containerType.code}</Chip>
                      )}
                      <Chip tone={c.status === "sealed" ? "success" : "warning"}>
                        {c.status}
                      </Chip>
                      <span className="ml-auto text-body-sm text-ink-muted">
                        {c.itemCount} lines · {c.unitCount} units ·{" "}
                        {fmtKg(c.actualWeightKg ?? c.estWeightKg)}
                      </span>
                    </div>
                    <table className="w-full text-body-sm">
                      <thead className="bg-canvas/50 text-caption text-ink-muted uppercase tracking-wider">
                        <tr>
                          <th className="text-left px-3 py-1.5">Item</th>
                          <th className="text-left px-3 py-1.5">Variant</th>
                          <th className="text-left px-3 py-1.5">Barcode</th>
                          <th className="text-right px-3 py-1.5">Qty</th>
                          <th className="text-left px-3 py-1.5 pl-2">UOM</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {c.lines.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-3 py-2 text-ink-muted">
                              Empty container.
                            </td>
                          </tr>
                        )}
                        {c.lines.map((ln) => (
                          <tr key={ln.packingSlipItemId}>
                            <td className="px-3 py-1.5">
                              <div className="font-semibold">{ln.productName}</div>
                              <div className="text-caption text-ink-muted">
                                {ln.productSku}
                              </div>
                            </td>
                            <td className="px-3 py-1.5">{ln.variant || "—"}</td>
                            <td className="px-3 py-1.5 font-mono text-caption">
                              {ln.variantBarcode ?? ln.productBarcode ?? "—"}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono">
                              {ln.qty}
                            </td>
                            <td className="px-3 py-1.5 pl-2 text-ink-muted">
                              {ln.uom}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </Card>

            {reportQ.data.unallocated.length > 0 && (
              <Card title="Unallocated qty" accent="warning">
                <table className="w-full text-body-sm">
                  <thead className="text-caption text-ink-muted uppercase tracking-wider">
                    <tr>
                      <th className="text-left py-1.5">Item</th>
                      <th className="text-left py-1.5">Variant</th>
                      <th className="text-right py-1.5">Packed</th>
                      <th className="text-right py-1.5">Allocated</th>
                      <th className="text-right py-1.5">Short</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {reportQ.data.unallocated.map((u) => (
                      <tr key={u.packingSlipItemId}>
                        <td className="py-1.5">
                          <div className="font-semibold">{u.productName}</div>
                          <div className="text-caption text-ink-muted">{u.productSku}</div>
                        </td>
                        <td className="py-1.5">{u.variant || "—"}</td>
                        <td className="py-1.5 text-right font-mono">
                          {u.qtyPacked}
                        </td>
                        <td className="py-1.5 text-right font-mono">
                          {u.allocated}
                        </td>
                        <td className="py-1.5 text-right font-mono text-warning">
                          {u.shortage.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// =====================================================================
// 2. Item history
// =====================================================================
const ItemHistoryTab = ({ initialBarcode }: { initialBarcode?: string }) => {
  const [code, setCode] = useState(initialBarcode ?? "");
  const [search, setSearch] = useState(initialBarcode ?? "");
  const [days, setDays] = useState(90);

  const reportQ = useApi(
    () =>
      search
        ? api.itemContainerHistory({ barcode: search, days, limit: 200 })
        : Promise.resolve(null),
    [search, days]
  );

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <Input
              label="SKU or barcode"
              placeholder="Scan or paste a code"
              value={code}
              iconLeft={<Search size={14} />}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setSearch(code.trim());
              }}
            />
          </div>
          <div className="w-32">
            <Input
              label="Days back"
              type="number"
              value={String(days)}
              onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 90))}
            />
          </div>
          <Button onClick={() => setSearch(code.trim())}>Search</Button>
          {search && (
            <Button
              variant="outline"
              icon={<Download size={14} />}
              onClick={() =>
                downloadFile(
                  "/reports/item-container-history",
                  `item-history-${search}.csv`,
                  { query: { barcode: search, days, format: "csv" } }
                )
              }
            >
              CSV
            </Button>
          )}
        </div>
      </Card>

      {reportQ.loading && <EmptyState loading />}
      {reportQ.error && (
        <EmptyState error={reportQ.error} onRetry={reportQ.refetch} />
      )}
      {reportQ.data && (
        <Card
          title={`${reportQ.data.count} container${reportQ.data.count === 1 ? "" : "s"}`}
          subtitle={`Since ${new Date(reportQ.data.sinceDate).toLocaleDateString()}`}
        >
          {reportQ.data.rows.length === 0 && (
            <div className="text-body-sm text-ink-muted">
              No containers found for this item in the selected window.
            </div>
          )}
          <table className="w-full text-body-sm">
            <thead className="text-caption text-ink-muted uppercase tracking-wider">
              <tr>
                <th className="text-left py-1.5">Packed</th>
                <th className="text-left py-1.5">Slip</th>
                <th className="text-left py-1.5">Container</th>
                <th className="text-left py-1.5">SO</th>
                <th className="text-left py-1.5">Customer</th>
                <th className="text-left py-1.5">Trip</th>
                <th className="text-right py-1.5">Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {reportQ.data.rows.map((r) => (
                <tr key={`${r.containerId}-${r.packingSlipId}`}>
                  <td className="py-1.5 whitespace-nowrap">
                    {r.packedAt
                      ? new Date(r.packedAt).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="py-1.5 font-mono text-caption">
                    {r.packingSlipNo}
                  </td>
                  <td className="py-1.5">
                    <div className="font-mono font-semibold">{r.containerLabel}</div>
                    <div className="text-caption text-ink-muted font-mono">
                      {r.containerCode}
                    </div>
                  </td>
                  <td className="py-1.5 font-mono text-caption">
                    {r.salesOrder?.soNo ?? ""}
                  </td>
                  <td className="py-1.5">{r.salesOrder?.customer?.name ?? ""}</td>
                  <td className="py-1.5">
                    {r.dispatches.length === 0 ? (
                      <span className="text-ink-muted">—</span>
                    ) : (
                      r.dispatches.map((d, i) => (
                        <div key={i} className="text-caption">
                          <span className="font-mono">{d.dispatchNo}</span>
                          {d.tripNo && (
                            <span className="text-ink-muted"> · {d.tripNo}</span>
                          )}
                        </div>
                      ))
                    )}
                  </td>
                  <td className="py-1.5 text-right font-mono">{r.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
};

// =====================================================================
// 3. Trip manifest
// =====================================================================
const TripManifestTab = ({ initialTripId }: { initialTripId?: string | null }) => {
  const [tripId, setTripId] = useState<string | null>(initialTripId ?? null);
  const tripsQ = useApi(() => api.trips(), []);
  const reportQ = useApi(
    () => (tripId ? api.tripManifest(tripId) : Promise.resolve(null)),
    [tripId]
  );

  useEffect(() => {
    if (!tripId && tripsQ.data && tripsQ.data.length > 0) {
      setTripId(tripsQ.data[0].id);
    }
  }, [tripId, tripsQ.data]);

  return (
    <div className="grid grid-cols-12 gap-4">
      <Card title="Trips" className="col-span-3" bodyClassName="!p-0">
        <div className="max-h-[70vh] overflow-y-auto divide-y divide-border">
          {tripsQ.loading && (
            <div className="p-3 text-body-sm text-ink-muted">Loading…</div>
          )}
          {(tripsQ.data ?? []).map((t: TripRow) => (
            <button
              key={t.id}
              onClick={() => setTripId(t.id)}
              className={cn(
                "w-full text-left px-3 py-2 hover:bg-canvas transition-colors flex flex-col",
                tripId === t.id && "bg-primary/5"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-body-sm font-semibold">
                  {t.tripNo}
                </span>
                <Chip tone="neutral">{t.status}</Chip>
              </div>
              <div className="text-caption text-ink-muted truncate">
                {new Date(t.scheduledDate).toLocaleDateString()} · {t.vehicle}
              </div>
            </button>
          ))}
        </div>
      </Card>

      <div className="col-span-9 space-y-4">
        {reportQ.loading && <EmptyState loading />}
        {reportQ.error && (
          <EmptyState error={reportQ.error} onRetry={reportQ.refetch} />
        )}
        {reportQ.data && (
          <>
            <div className="grid grid-cols-5 gap-3">
              <Kpi label="Stops" value={String(reportQ.data.totals.stopCount)} />
              <Kpi
                label="Containers"
                value={String(reportQ.data.totals.containerCount)}
              />
              <Kpi label="Units" value={String(reportQ.data.totals.unitCount)} />
              <Kpi
                label="Weight"
                value={fmtKg(reportQ.data.totals.weightKg)}
                hint={`of ${fmtKg(reportQ.data.totals.capacityKg)} capacity`}
              />
              <Kpi
                label="Utilisation"
                value={`${capacityPct(reportQ.data.totals.weightKg, reportQ.data.totals.capacityKg)}%`}
              />
            </div>

            <Card
              title={
                <div className="flex items-center gap-2">
                  <span>{reportQ.data.trip.tripNo}</span>
                  <Chip tone="neutral">{reportQ.data.trip.status}</Chip>
                </div>
              }
              subtitle={`${new Date(reportQ.data.trip.scheduledDate).toLocaleDateString()} · ${reportQ.data.trip.vehicle} · ${reportQ.data.trip.driver}`}
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Download size={14} />}
                  onClick={() =>
                    downloadFile(
                      `/reports/trip-manifest/${reportQ.data!.trip.id}`,
                      `trip-manifest-${reportQ.data!.trip.tripNo}.csv`,
                      { query: { format: "csv" } }
                    )
                  }
                >
                  CSV
                </Button>
              }
            >
              <div className="space-y-3">
                {reportQ.data.stops.map((st) => (
                  <div
                    key={st.dispatchId}
                    className="border border-border rounded-lg overflow-hidden"
                  >
                    <div className="bg-canvas px-3 py-2 border-b border-border flex flex-wrap items-center gap-2">
                      <span className="font-mono font-semibold">
                        {st.dispatchNo}
                      </span>
                      <span className="text-body-sm">
                        {st.customer?.name ?? ""}
                      </span>
                      {st.customer?.city && (
                        <Chip tone="neutral">{st.customer.city}</Chip>
                      )}
                      <span className="ml-auto text-body-sm text-ink-muted">
                        {st.containerCount} containers · {st.unitCount} units ·{" "}
                        {fmtKg(st.actualWeightKg ?? st.estWeightKg)}
                      </span>
                    </div>
                    <div className="p-3 space-y-2">
                      {st.containers.length === 0 && (
                        <div className="text-body-sm text-ink-muted">
                          No containers on this stop.
                        </div>
                      )}
                      {st.containers.map((c) => (
                        <div
                          key={c.id}
                          className="border border-border rounded-md p-2"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold">{c.label}</span>
                            <span className="font-mono text-caption text-ink-muted">
                              {c.code}
                            </span>
                            {c.containerType && (
                              <Chip tone="neutral">{c.containerType.code}</Chip>
                            )}
                            <Chip
                              tone={c.status === "sealed" ? "success" : "warning"}
                            >
                              {c.status}
                            </Chip>
                            <span className="ml-auto text-body-sm text-ink-muted">
                              {c.unitCount} units ·{" "}
                              {fmtKg(c.actualWeightKg ?? c.estWeightKg)}
                            </span>
                          </div>
                          {c.lines.length > 0 && (
                            <ul className="mt-1 text-caption text-ink-muted space-y-0.5">
                              {c.lines.map((ln, i) => (
                                <li key={i}>
                                  <span className="font-mono">{ln.productSku}</span>{" "}
                                  · {ln.productName}
                                  {ln.variant && ` (${ln.variant})`} ×{" "}
                                  <span className="font-mono">{ln.qty}</span>{" "}
                                  {ln.uom}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
};

// =====================================================================
// 4. Pack throughput
// =====================================================================
const ThroughputTab = () => {
  const [days, setDays] = useState(14);
  const reportQ = useApi(() => api.packThroughput(days), [days]);

  const chartData = useMemo(
    () =>
      (reportQ.data?.rows ?? []).map((r) => ({
        ...r,
        // Short day label for the X axis (Mon 06)
        day: new Date(r.day).toLocaleDateString(undefined, {
          weekday: "short",
          day: "2-digit",
        }),
      })),
    [reportQ.data]
  );

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-32">
            <Input
              label="Days"
              type="number"
              value={String(days)}
              onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 14))}
            />
          </div>
          <Button
            variant="outline"
            icon={<Download size={14} />}
            onClick={() =>
              downloadFile(
                "/reports/pack-throughput",
                `pack-throughput-${days}d.csv`,
                { query: { days, format: "csv" } }
              )
            }
          >
            CSV
          </Button>
        </div>
      </Card>

      {reportQ.loading && <EmptyState loading />}
      {reportQ.error && (
        <EmptyState error={reportQ.error} onRetry={reportQ.refetch} />
      )}
      {reportQ.data && (
        <>
          <div className="grid grid-cols-4 gap-3">
            <Kpi
              label="Slips packed"
              value={String(reportQ.data.totals.slips)}
            />
            <Kpi
              label="Containers sealed"
              value={String(reportQ.data.totals.containers)}
            />
            <Kpi label="Est. weight" value={fmtKg(reportQ.data.totals.estKg)} />
            <Kpi
              label="Actual weight"
              value={fmtKg(reportQ.data.totals.actualKg)}
            />
          </div>

          <Card title="Daily" bodyClassName="!pt-2">
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 10, right: 16, bottom: 0, left: 0 }}
                >
                  <CartesianGrid
                    stroke="#CBD2D6"
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="day"
                    stroke="#687173"
                    fontSize={11}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="#687173"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#1A1A2E",
                      border: "none",
                      borderRadius: 8,
                      color: "white",
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="slips" fill="#003087" name="Slips packed" />
                  <Bar dataKey="containers" fill="#009CDE" name="Containers" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
const slipStatusTone = (
  status: string
): "neutral" | "primary" | "success" | "warning" | "danger" => {
  switch (status) {
    case "packed":
      return "primary";
    case "invoiced":
      return "success";
    case "cancelled":
      return "danger";
    default:
      return "neutral";
  }
};

const capacityPct = (weight: number, capacity: number) => {
  if (capacity <= 0) return 0;
  return Math.min(100, Math.round((weight / capacity) * 100));
};
