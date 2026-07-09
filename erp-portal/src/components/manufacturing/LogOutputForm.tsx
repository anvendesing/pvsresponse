import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  History,
  Plus,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { api, type MoInventoryTrail, type MoOutputBatch } from "@/lib/api";
import type { Bom, BomByproductRow, ProductionOrder } from "@/data/types";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { isMoClosed } from "@/lib/mo-utils";

type ViewTab = "history" | "log";

type ByproductRowState = {
  bomByproductId: string;
  qty: number;
  touched: boolean;
};

const expectedFor = (bp: BomByproductRow, goodQty: number, batchSize: number): number => {
  if (!batchSize || batchSize <= 0) return 0;
  const raw = (bp.qty / batchSize) * goodQty;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.round(raw * 1000) / 1000;
};

const fmtLoggedAt = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const qtyCell = (value: number) => (value > 0 ? num(value) : "—");

interface Props {
  order: Pick<
    ProductionOrder,
    "id" | "orderNo" | "plannedQty" | "actualQty" | "scrapQty" | "reworkQty" | "status"
  >;
  bom: Pick<Bom, "outputQty" | "byproducts"> | null;
  alreadyLogged?: MoInventoryTrail["byproductsReleased"];
  onSaved: (msg: string) => void | Promise<void>;
}

export const LogOutputForm = ({ order, bom, alreadyLogged, onSaved }: Props) => {
  const closed = isMoClosed(order.status);
  const canLog =
    !closed && (order.status === "in-progress" || order.status === "qc");

  const remaining = Math.max(0, order.plannedQty - order.actualQty);
  const seedGood = remaining > 0 ? remaining : Math.max(1, Math.round(order.plannedQty / 4));

  const [viewTab, setViewTab] = useState<ViewTab>("history");
  const [batches, setBatches] = useState<MoOutputBatch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [inputQty, setInputQty] = useState(0);
  const [goodQty, setGoodQty] = useState(seedGood);
  const [scrapQty, setScrapQty] = useState(0);
  const [reworkQty, setReworkQty] = useState(0);
  const [byproducts, setByproducts] = useState<ByproductRowState[]>(() =>
    (bom?.byproducts ?? []).map((bp) => ({
      bomByproductId: bp.id ?? "",
      qty: expectedFor(bp, seedGood, bom?.outputQty ?? 1),
      touched: false,
    }))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBatches = useCallback(async () => {
    setBatchesLoading(true);
    try {
      const res = await api.getOutputBatches(order.id);
      setBatches(res.batches);
    } catch {
      setBatches([]);
    } finally {
      setBatchesLoading(false);
    }
  }, [order.id]);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  useEffect(() => {
    const nextGood = remaining > 0 ? remaining : Math.max(1, Math.round(order.plannedQty / 4));
    setInputQty(0);
    setGoodQty(nextGood);
    setScrapQty(0);
    setReworkQty(0);
    setByproducts(
      (bom?.byproducts ?? []).map((bp) => ({
        bomByproductId: bp.id ?? "",
        qty: expectedFor(bp, nextGood, bom?.outputQty ?? 1),
        touched: false,
      }))
    );
    setError(null);
  }, [order.id, order.actualQty, order.plannedQty, bom?.byproducts, bom?.outputQty, remaining]);

  useEffect(() => {
    if (!bom) return;
    setByproducts((prev) =>
      prev.map((row, i) => {
        const bp = bom.byproducts?.[i];
        if (!bp || row.touched) return row;
        return { ...row, qty: expectedFor(bp, goodQty, bom.outputQty) };
      })
    );
  }, [goodQty, bom]);

  const loggedByProductId = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of alreadyLogged ?? []) {
      m.set(r.productId, (m.get(r.productId) ?? 0) + r.qty);
    }
    return m;
  }, [alreadyLogged]);

  const batchesWithCum = useMemo(() => {
    let cumGood = 0;
    return batches.map((b) => {
      cumGood += b.goodQty;
      return { ...b, cumGoodQty: cumGood };
    });
  }, [batches]);

  const batchTotals = useMemo(
    () =>
      batches.reduce(
        (acc, b) => ({
          inputQty: acc.inputQty + b.inputQty,
          goodQty: acc.goodQty + b.goodQty,
          scrapQty: acc.scrapQty + b.scrapQty,
          reworkQty: acc.reworkQty + b.reworkQty,
        }),
        { inputQty: 0, goodQty: 0, scrapQty: 0, reworkQty: 0 }
      ),
    [batches]
  );

  const completionPct =
    order.plannedQty > 0
      ? Math.round((order.actualQty / order.plannedQty) * 1000) / 10
      : 0;

  const previewCumGood = order.actualQty + goodQty;

  const updateBp = (idx: number, qty: number) => {
    setByproducts((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, qty, touched: true } : row))
    );
  };

  const useRatioFor = (idx: number) => {
    if (!bom) return;
    const bp = bom.byproducts?.[idx];
    if (!bp) return;
    setByproducts((prev) =>
      prev.map((row, i) =>
        i === idx
          ? { ...row, qty: expectedFor(bp, goodQty, bom.outputQty), touched: false }
          : row
      )
    );
  };

  const submit = async () => {
    if (!Number.isFinite(goodQty) || goodQty < 0) {
      setError("Good qty must be a non-negative number.");
      return;
    }
    if (
      inputQty === 0 &&
      goodQty === 0 &&
      scrapQty === 0 &&
      reworkQty === 0 &&
      byproducts.every((r) => r.qty === 0)
    ) {
      setError("Nothing to log. Enter at least one quantity.");
      return;
    }
    const bpPayload = byproducts
      .filter((r) => r.bomByproductId && r.qty > 0)
      .map((r) => ({ bomByproductId: r.bomByproductId, qty: r.qty }));

    setBusy(true);
    setError(null);
    try {
      const res = await api.logOutput(order.id, {
        inputQty,
        goodQty,
        scrapQty,
        reworkQty,
        byproducts: bpPayload,
      });
      const bpCount = res.byproductPostings?.length ?? 0;
      const summary = [
        inputQty > 0 ? `${num(inputQty)} in` : null,
        `${num(goodQty)} good`,
        scrapQty > 0 ? `${num(scrapQty)} scrap` : null,
        reworkQty > 0 ? `${num(reworkQty)} rework` : null,
        bpCount > 0 ? `${bpCount} byproduct${bpCount === 1 ? "" : "s"} posted` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      await onSaved(`Logged batch on ${order.orderNo}: ${summary}.`);
      if (res.outputBatch) {
        setBatches((prev) => [...prev, res.outputBatch!]);
      } else {
        await loadBatches();
      }
      setInputQty(0);
      setScrapQty(0);
      setReworkQty(0);
      setViewTab("history");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const bomBps = bom?.byproducts ?? [];
  const hasByproducts = bomBps.length > 0;
  const colSpan = 8;

  if (closed) return null;

  return (
    <Card
      title="Log output"
      subtitle="Batch history and per-batch input, output, and byproduct logging"
      actions={
        canLog ? (
          viewTab === "log" ? (
            <Button
              size="sm"
              icon={<CheckCircle2 size={14} />}
              onClick={() => void submit()}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save batch"}
            </Button>
          ) : (
            <Button
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => setViewTab("log")}
            >
              Log batch
            </Button>
          )
        ) : null
      }
    >
      {!canLog && (
        <div className="mb-4 px-3 py-2 rounded-md bg-canvas border border-border text-body-sm text-ink-muted">
          Log output is available once the MO is <strong>in progress</strong> (after materials are issued).
        </div>
      )}

      {error && (
        <div className="mb-4 px-3 py-2 bg-danger-soft border border-danger text-danger text-body-sm flex items-center gap-2 rounded-md">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      <div className="mb-4 rounded-md border border-border bg-canvas px-3 py-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-body-sm">
        <span>
          <span className="text-ink-muted">Planned </span>
          <span className="tnum font-semibold">{num(order.plannedQty)}</span>
        </span>
        <span>
          <span className="text-ink-muted">Logged good </span>
          <span className="tnum font-semibold">{num(order.actualQty)}</span>
        </span>
        <span>
          <span className="text-ink-muted">Scrap </span>
          <span className="tnum font-semibold">{num(order.scrapQty)}</span>
        </span>
        <span>
          <span className="text-ink-muted">Rework </span>
          <span className="tnum font-semibold">{num(order.reworkQty)}</span>
        </span>
        <span>
          <span className="text-ink-muted">Remaining </span>
          <span className="tnum font-semibold">{num(remaining)}</span>
        </span>
        <span className="ml-auto">
          <span className="tnum font-semibold">{completionPct}%</span>
          <span className="text-ink-muted"> complete</span>
        </span>
      </div>

      <div className="flex gap-1 border-b border-border mb-4">
        {(
          [
            {
              id: "history" as const,
              label: "Batch history",
              icon: <History size={14} />,
              count: batches.length,
            },
            ...(canLog
              ? [
                  {
                    id: "log" as const,
                    label: "Log new batch",
                    icon: <ClipboardList size={14} />,
                    count: null as number | null,
                  },
                ]
              : []),
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setViewTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-body-sm whitespace-nowrap border-b-2 transition-colors -mb-px",
              viewTab === tab.id
                ? "border-primary text-primary font-semibold bg-primary/5"
                : "border-transparent text-ink-muted hover:text-ink hover:bg-canvas"
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.count != null && tab.count > 0 && (
              <span
                className={cn(
                  "ml-0.5 inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tnum",
                  viewTab === tab.id ? "bg-primary text-white" : "bg-canvas text-ink-muted"
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {viewTab === "history" && (
        <div className="rounded-md border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm tnum">
              <thead>
                <tr className="grid-header-cell text-caption text-left">
                  <th className="px-3 py-2 font-semibold w-16">Batch</th>
                  <th className="px-3 py-2 font-semibold">Time</th>
                  <th className="px-3 py-2 font-semibold text-right">Input</th>
                  <th className="px-3 py-2 font-semibold text-right">Good</th>
                  <th className="px-3 py-2 font-semibold text-right">Scrap</th>
                  <th className="px-3 py-2 font-semibold text-right">Rework</th>
                  <th className="px-3 py-2 font-semibold text-right">Cum. good</th>
                  <th className="px-3 py-2 font-semibold">By-products</th>
                </tr>
              </thead>
              <tbody>
                {batchesLoading ? (
                  <tr>
                    <td colSpan={colSpan} className="px-3 py-6 text-caption text-ink-muted text-center">
                      Loading batch history…
                    </td>
                  </tr>
                ) : batchesWithCum.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="px-3 py-8 text-center">
                      <p className="text-body-sm text-ink-muted mb-3">No batches logged yet.</p>
                      {canLog && (
                        <Button size="sm" icon={<Plus size={14} />} onClick={() => setViewTab("log")}>
                          Log first batch
                        </Button>
                      )}
                    </td>
                  </tr>
                ) : (
                  <>
                    {batchesWithCum.map((batch) => (
                      <Fragment key={batch.id}>
                        <tr className="border-t border-border align-middle hover:bg-canvas/50">
                          <td className="px-3 py-2.5 font-semibold text-ink-muted">
                            #{batch.batchSeq}
                          </td>
                          <td className="px-3 py-2.5 text-ink-muted whitespace-nowrap">
                            {fmtLoggedAt(batch.loggedAt)}
                          </td>
                          <td className="px-3 py-2.5 text-right">{qtyCell(batch.inputQty)}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-ink">
                            {qtyCell(batch.goodQty)}
                          </td>
                          <td className="px-3 py-2.5 text-right">{qtyCell(batch.scrapQty)}</td>
                          <td className="px-3 py-2.5 text-right">{qtyCell(batch.reworkQty)}</td>
                          <td className="px-3 py-2.5 text-right text-ink-muted">
                            {num(batch.cumGoodQty)}
                          </td>
                          <td className="px-3 py-2.5 text-caption text-ink-muted max-w-[200px]">
                            {batch.byproducts.length > 0 ? (
                              <ul className="space-y-0.5">
                                {batch.byproducts.map((bp) => (
                                  <li key={bp.bomByproductId} className="truncate">
                                    <span className="font-mono">{bp.sku}</span>{" "}
                                    {num(bp.qty, 3)} {bp.uom}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                    <tr className="border-t-2 border-border bg-canvas font-semibold">
                      <td className="px-3 py-2.5 text-caption uppercase text-ink-muted" colSpan={2}>
                        Totals ({batches.length} batch{batches.length === 1 ? "" : "es"})
                      </td>
                      <td className="px-3 py-2.5 text-right">{qtyCell(batchTotals.inputQty)}</td>
                      <td className="px-3 py-2.5 text-right">{qtyCell(batchTotals.goodQty)}</td>
                      <td className="px-3 py-2.5 text-right">{qtyCell(batchTotals.scrapQty)}</td>
                      <td className="px-3 py-2.5 text-right">{qtyCell(batchTotals.reworkQty)}</td>
                      <td className="px-3 py-2.5 text-right text-ink-muted">
                        {num(order.actualQty)}
                      </td>
                      <td className="px-3 py-2.5" />
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewTab === "log" && canLog && (
        <div className="space-y-4">
          <div className="rounded-md border border-border overflow-hidden">
            <div className="px-3 py-2 bg-canvas border-b border-border text-caption font-semibold uppercase text-ink-muted">
              Input
            </div>
            <table className="w-full text-body-sm">
              <tbody>
                <tr className="border-t border-border">
                  <td className="px-3 py-3 w-1/3 text-ink-muted">
                    Material / WIP consumed
                    <div className="text-caption mt-0.5 normal-case font-normal">
                      Optional — qty fed into this production step
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={inputQty}
                      onChange={(e) => setInputQty(Number(e.target.value))}
                      disabled={busy}
                      className="max-w-[160px] text-right tnum"
                      placeholder="0"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="rounded-md border border-border overflow-hidden">
            <div className="px-3 py-2 bg-canvas border-b border-border text-caption font-semibold uppercase text-ink-muted">
              Output
            </div>
            <table className="w-full text-body-sm tnum">
              <thead>
                <tr className="grid-header-cell text-caption text-left">
                  <th className="px-3 py-2 font-semibold w-1/3">Type</th>
                  <th className="px-3 py-2 font-semibold">Qty this batch</th>
                  <th className="px-3 py-2 font-semibold text-right">MO running total</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    {
                      key: "good",
                      label: "Good",
                      hint: "Finished units that count toward MO completion",
                      value: goodQty,
                      set: setGoodQty,
                      running: order.actualQty,
                      preview: previewCumGood,
                      emphasize: true,
                    },
                    {
                      key: "scrap",
                      label: "Scrap",
                      hint: "Rejected or wasted units",
                      value: scrapQty,
                      set: setScrapQty,
                      running: order.scrapQty,
                      preview: order.scrapQty + scrapQty,
                      emphasize: false,
                    },
                    {
                      key: "rework",
                      label: "Rework",
                      hint: "Units sent back for correction",
                      value: reworkQty,
                      set: setReworkQty,
                      running: order.reworkQty,
                      preview: order.reworkQty + reworkQty,
                      emphasize: false,
                    },
                  ] as const
                ).map((row) => (
                  <tr key={row.key} className="border-t border-border align-middle">
                    <td className="px-3 py-3">
                      <div className={cn("font-medium", row.emphasize && "text-ink")}>
                        {row.label}
                      </div>
                      <div className="text-caption text-ink-muted normal-case font-normal mt-0.5">
                        {row.hint}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={row.value}
                        onChange={(e) => row.set(Number(e.target.value))}
                        disabled={busy}
                        className="max-w-[160px] text-right"
                      />
                    </td>
                    <td className="px-3 py-3 text-right text-ink-muted">
                      {num(row.running)} →{" "}
                      <span className={cn(row.emphasize && "font-semibold text-ink")}>
                        {num(row.preview)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasByproducts ? (
            <div className="rounded-md border border-border overflow-hidden">
              <div className="px-3 py-2 bg-canvas border-b border-border flex items-center justify-between">
                <div className="text-caption font-semibold uppercase text-ink-muted">
                  By-products
                </div>
                <Chip size="sm" tone="info">
                  Posted to inventory on save
                </Chip>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-body-sm">
                  <thead>
                    <tr className="grid-header-cell text-caption text-left">
                      <th className="px-3 py-2 font-semibold">Component</th>
                      <th className="px-3 py-2 font-semibold text-right">Per BOM batch</th>
                      <th className="px-3 py-2 font-semibold text-right">Expected</th>
                      <th className="px-3 py-2 font-semibold w-36">Actual qty</th>
                      <th className="px-3 py-2 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {bomBps.map((bp, i) => {
                      const expected = expectedFor(bp, goodQty, bom?.outputQty ?? 1);
                      const row = byproducts[i];
                      const logged = bp.productId
                        ? loggedByProductId.get(bp.productId) ?? 0
                        : 0;
                      return (
                        <tr key={bp.id ?? bp.sku} className="border-t border-border align-middle">
                          <td className="px-3 py-2.5">
                            <div className="font-mono text-caption text-ink-muted">{bp.sku}</div>
                            <div className="truncate">{bp.name}</div>
                            {logged > 0 && (
                              <div className="text-caption text-ink-muted mt-0.5 tnum">
                                MO total posted {num(logged)} {bp.uom}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right tnum text-ink-muted">
                            {num(bp.qty, 3)} {bp.uom}
                          </td>
                          <td className="px-3 py-2.5 text-right tnum">
                            {num(expected, 3)} {bp.uom}
                          </td>
                          <td className="px-3 py-2.5">
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              size="sm"
                              value={row?.qty ?? 0}
                              onChange={(e) => updateBp(i, Number(e.target.value))}
                              disabled={busy}
                              className="text-right tnum"
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              onClick={() => useRatioFor(i)}
                              className="h-7 w-7 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
                              title="Set to BOM-expected qty"
                              disabled={busy}
                            >
                              <Wand2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-caption text-ink-muted px-1">No by-products on this BOM.</p>
          )}

          <div className="rounded-md border border-primary/20 bg-primary-soft/20 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-body-sm">
            <span className="text-ink-muted">After this batch</span>
            <span className="tnum font-semibold">
              {order.plannedQty > 0
                ? `${Math.round((previewCumGood / order.plannedQty) * 1000) / 10}% · `
                : ""}
              {num(previewCumGood)} / {num(order.plannedQty)} good
            </span>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setViewTab("history")} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              icon={<CheckCircle2 size={14} />}
              onClick={() => void submit()}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save batch"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};
