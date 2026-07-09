// CRM: Enquiries / leads pipeline.
//
// Two views over the same data:
//   • Pipeline — a Kanban board; drag cards between stages.
//   • List     — a flat searchable table.
// Clicking any enquiry opens a detail drawer with line items, an activity
// timeline + follow-up tasks, stage controls, and a Convert-to-Customer action.

import { backdropDismissProps } from "@/hooks/useBackdropDismiss";
import { useMemo, useState } from "react";
import {
  AlertTriangle, BarChart3, Building2, CheckCircle2, Clock, KanbanSquare,
  List, Phone, Plus, Search, Trash2, TrendingUp, UserPlus, X,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import { useApi } from "@/hooks/useApi";
import { api } from "@/lib/api";
import type {
  Enquiry, EnquiryActivity, EnquiryInput, EnquiryStage, EnquiryType,
} from "@/data/types";
import { inr, dd } from "@/lib/format";
import { cn } from "@/lib/cn";

const STAGES: { id: EnquiryStage; label: string; tone: string }[] = [
  { id: "new",       label: "New",       tone: "border-t-info" },
  { id: "contacted", label: "Contacted", tone: "border-t-primary" },
  { id: "qualified", label: "Qualified", tone: "border-t-warning" },
  { id: "proposal",  label: "Proposal",  tone: "border-t-purple-500" },
  { id: "won",       label: "Won",       tone: "border-t-success" },
  { id: "lost",      label: "Lost",      tone: "border-t-danger" },
];

const TYPE_META: Record<EnquiryType, { label: string; cls: string }> = {
  product:    { label: "Product",    cls: "bg-primary-50 text-primary border-primary/30" },
  dealership: { label: "Dealership", cls: "bg-warning-soft text-[#8a6300] border-warning/30" },
  farm_visit: { label: "Farm visit", cls: "bg-success-soft text-success border-success/30" },
  other:      { label: "Other",      cls: "bg-canvas text-ink-muted border-border" },
};

const PRIORITY_META: Record<string, { label: string; cls: string }> = {
  high:   { label: "High",   cls: "bg-danger/10 text-danger" },
  medium: { label: "Medium", cls: "bg-warning-soft text-[#8a6300]" },
  low:    { label: "Low",    cls: "bg-canvas text-ink-muted" },
};

const TYPE_OPTIONS: EnquiryType[] = ["product", "dealership", "farm_visit", "other"];
const SOURCE_OPTIONS = [
  "walk_in", "phone", "website", "contact_page", "whatsapp", "referral", "exhibition", "social", "other",
];

export const Enquiries = () => {
  const [view, setView] = useState<"pipeline" | "list">("pipeline");
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | EnquiryType>("");
  const [followUpsOnly, setFollowUpsOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const stats = useApi(() => api.enquiryStats(), []);
  const list = useApi(() => api.enquiries({ limit: "500" }), []);
  const enquiries = list.data ?? [];

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return enquiries.filter((e) => {
      if (typeFilter && e.type !== typeFilter) return false;
      if (followUpsOnly) {
        const due = e.nextFollowUpAt && new Date(e.nextFollowUpAt) <= new Date();
        if (!due || e.stage === "won" || e.stage === "lost") return false;
      }
      if (!term) return true;
      return (
        e.enquiryNo.toLowerCase().includes(term) ||
        e.contactName.toLowerCase().includes(term) ||
        (e.company ?? "").toLowerCase().includes(term) ||
        e.subject.toLowerCase().includes(term) ||
        (e.phone ?? "").toLowerCase().includes(term)
      );
    });
  }, [enquiries, q, typeFilter, followUpsOnly]);

  const byStage = useMemo(() => {
    const m: Record<string, Enquiry[]> = {};
    for (const s of STAGES) m[s.id] = [];
    for (const e of filtered) (m[e.stage] ??= []).push(e);
    return m;
  }, [filtered]);

  const refreshAll = () => {
    void list.refetch();
    void stats.refetch();
  };

  const moveStage = async (e: Enquiry, stage: EnquiryStage) => {
    if (e.stage === stage) return;
    if (stage === "lost") {
      const reason = window.prompt("Reason for marking this enquiry lost?") ?? undefined;
      await api.setEnquiryStage(e.id, stage, reason);
    } else {
      await api.setEnquiryStage(e.id, stage);
    }
    refreshAll();
  };

  const s = stats.data;

  return (
    <div className="h-full flex flex-col">
      {/* Header + KPIs */}
      <div className="px-6 pt-5 pb-3 border-b border-border bg-surface">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-h2 font-bold">Enquiries</h1>
            <p className="text-body-sm text-ink-muted">
              Capture leads, work the pipeline, convert winners to customers.
            </p>
          </div>
          <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>
            New enquiry
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <Kpi icon={<KanbanSquare size={16} />} label="Open" value={s ? String(s.open) : "…"} tone="text-primary" />
          <Kpi icon={<TrendingUp size={16} />}   label="Pipeline value" value={s ? inr(s.pipelineValue) : "…"} tone="text-ink" />
          <Kpi icon={<Clock size={16} />}        label="Follow-ups due" value={s ? String(s.followUpsDue) : "…"} tone={s && s.followUpsDue > 0 ? "text-danger" : "text-ink-muted"} />
          <Kpi icon={<CheckCircle2 size={16} />} label="Won" value={s ? String(s.won) : "…"} tone="text-success" />
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-6 py-3 flex items-center gap-2 flex-wrap border-b border-border bg-canvas/40">
        <div className="flex rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setView("pipeline")}
            className={cn("flex items-center gap-1.5 px-3 h-9 text-body-sm font-medium", view === "pipeline" ? "bg-primary text-white" : "bg-surface text-ink-muted hover:text-ink")}
          >
            <KanbanSquare size={15} /> Pipeline
          </button>
          <button
            onClick={() => setView("list")}
            className={cn("flex items-center gap-1.5 px-3 h-9 text-body-sm font-medium", view === "list" ? "bg-primary text-white" : "bg-surface text-ink-muted hover:text-ink")}
          >
            <List size={15} /> List
          </button>
        </div>

        <div className="w-64">
          <Input size="sm" placeholder="Search enquiries…" value={q} onChange={(e) => setQ(e.target.value)} iconLeft={<Search size={14} />} />
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as "" | EnquiryType)}
          className="h-9 px-2 rounded-md border border-border bg-surface text-body-sm"
        >
          <option value="">All types</option>
          {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
        </select>

        <button
          onClick={() => setFollowUpsOnly((v) => !v)}
          className={cn("flex items-center gap-1.5 h-9 px-3 rounded-md border text-body-sm font-medium", followUpsOnly ? "bg-danger/10 text-danger border-danger/30" : "bg-surface text-ink-muted border-border hover:text-ink")}
        >
          <Clock size={14} /> Follow-ups due
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {list.loading ? (
          <div className="p-10 text-center text-ink-muted">Loading…</div>
        ) : list.error ? (
          <div className="p-10 text-center text-danger">{list.error.message}</div>
        ) : view === "pipeline" ? (
          <div className="h-full overflow-x-auto p-4">
            <div className="flex gap-3 h-full min-w-max">
              {STAGES.map((stage) => (
                <KanbanColumn
                  key={stage.id}
                  stage={stage}
                  items={byStage[stage.id] ?? []}
                  onOpen={setOpenId}
                  onDropCard={(id) => {
                    const e = enquiries.find((x) => x.id === id);
                    if (e) void moveStage(e, stage.id);
                  }}
                />
              ))}
            </div>
          </div>
        ) : (
          <ListView items={filtered} onOpen={setOpenId} />
        )}
      </div>

      {openId && (
        <EnquiryDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={refreshAll}
        />
      )}
      {creating && (
        <NewEnquiryModal
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); refreshAll(); }}
        />
      )}
    </div>
  );
};

const Kpi = ({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) => (
  <div className="rounded-lg border border-border bg-surface px-3 py-2">
    <div className="flex items-center gap-1.5 text-caption text-ink-muted uppercase tracking-wide">
      {icon} {label}
    </div>
    <div className={cn("text-h3 font-bold mt-0.5 tnum", tone)}>{value}</div>
  </div>
);

// ─── Kanban ──────────────────────────────────────────────────────────────
const KanbanColumn = ({
  stage, items, onOpen, onDropCard,
}: {
  stage: { id: EnquiryStage; label: string; tone: string };
  items: Enquiry[];
  onOpen: (id: string) => void;
  onDropCard: (id: string) => void;
}) => {
  const [over, setOver] = useState(false);
  const value = items.reduce((sum, e) => sum + (e.estimatedValue || 0), 0);
  return (
    <div
      className={cn(
        "w-72 shrink-0 flex flex-col bg-canvas/60 rounded-lg border-t-2 border border-border",
        stage.tone, over && "ring-2 ring-primary/40"
      )}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData("text/enquiry");
        if (id) onDropCard(id);
      }}
    >
      <div className="px-3 py-2 flex items-center justify-between">
        <div className="font-semibold text-body-sm">{stage.label}</div>
        <div className="text-caption text-ink-muted">{items.length} · {inr(value)}</div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
        {items.map((e) => (
          <article
            key={e.id}
            draggable
            onDragStart={(ev) => ev.dataTransfer.setData("text/enquiry", e.id)}
            onClick={() => onOpen(e.id)}
            className="bg-surface border border-border rounded-md p-2.5 cursor-pointer hover:border-primary/50 hover:shadow-sm transition"
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-caption font-mono text-ink-muted">{e.enquiryNo}</span>
              <span className={cn("text-[10px] rounded-full px-1.5 py-0.5 border", TYPE_META[e.type].cls)}>
                {TYPE_META[e.type].label}
              </span>
            </div>
            <div className="font-semibold text-body-sm mt-1 line-clamp-1">{e.subject}</div>
            <div className="text-caption text-ink-muted line-clamp-1">
              {e.company || e.contactName}
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span className={cn("text-[10px] rounded px-1.5 py-0.5", PRIORITY_META[e.priority]?.cls)}>
                {PRIORITY_META[e.priority]?.label}
              </span>
              {e.estimatedValue > 0 && (
                <span className="text-caption font-semibold tnum">{inr(e.estimatedValue)}</span>
              )}
            </div>
            {e.nextFollowUpAt && new Date(e.nextFollowUpAt) <= new Date() && e.stage !== "won" && e.stage !== "lost" && (
              <div className="flex items-center gap-1 mt-1 text-[10px] text-danger">
                <AlertTriangle size={10} /> Follow-up due
              </div>
            )}
          </article>
        ))}
        {items.length === 0 && (
          <div className="text-caption text-ink-muted/60 text-center py-6">Drop here</div>
        )}
      </div>
    </div>
  );
};

// ─── List view ─────────────────────────────────────────────────────────
const ListView = ({ items, onOpen }: { items: Enquiry[]; onOpen: (id: string) => void }) => (
  <div className="h-full overflow-auto">
    <table className="w-full text-body-sm">
      <thead className="sticky top-0 bg-canvas border-b border-border text-caption uppercase tracking-wide text-ink-muted">
        <tr>
          <th className="text-left px-4 py-2 font-semibold">Enquiry</th>
          <th className="text-left px-4 py-2 font-semibold">Contact</th>
          <th className="text-left px-4 py-2 font-semibold">Type</th>
          <th className="text-left px-4 py-2 font-semibold">Stage</th>
          <th className="text-right px-4 py-2 font-semibold">Value</th>
          <th className="text-left px-4 py-2 font-semibold">Follow-up</th>
          <th className="text-left px-4 py-2 font-semibold">Updated</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/60">
        {items.map((e) => (
          <tr key={e.id} onClick={() => onOpen(e.id)} className="cursor-pointer hover:bg-canvas/60">
            <td className="px-4 py-2.5">
              <div className="font-mono text-caption text-ink-muted">{e.enquiryNo}</div>
              <div className="font-semibold line-clamp-1">{e.subject}</div>
            </td>
            <td className="px-4 py-2.5">
              <div>{e.contactName}</div>
              <div className="text-caption text-ink-muted">{e.company || e.phone || "—"}</div>
            </td>
            <td className="px-4 py-2.5">
              <span className={cn("text-[10px] rounded-full px-1.5 py-0.5 border", TYPE_META[e.type].cls)}>
                {TYPE_META[e.type].label}
              </span>
            </td>
            <td className="px-4 py-2.5">
              <span className="capitalize">{e.stage}</span>
            </td>
            <td className="px-4 py-2.5 text-right tnum">{e.estimatedValue > 0 ? inr(e.estimatedValue) : "—"}</td>
            <td className="px-4 py-2.5">
              {e.nextFollowUpAt ? (
                <span className={cn(new Date(e.nextFollowUpAt) <= new Date() && e.stage !== "won" && e.stage !== "lost" ? "text-danger font-medium" : "text-ink-muted")}>
                  {dd(e.nextFollowUpAt)}
                </span>
              ) : <span className="text-ink-muted">—</span>}
            </td>
            <td className="px-4 py-2.5 text-ink-muted">{dd(e.updatedAt)}</td>
          </tr>
        ))}
        {items.length === 0 && (
          <tr><td colSpan={7} className="px-4 py-10 text-center text-ink-muted">No enquiries match.</td></tr>
        )}
      </tbody>
    </table>
  </div>
);

// ─── Detail drawer ────────────────────────────────────────────────────────
const EnquiryDrawer = ({
  id, onClose, onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) => {
  const detail = useApi(() => api.enquiry(id), [id]);
  const e = detail.data;

  const [noteBody, setNoteBody] = useState("");
  const [noteType, setNoteType] = useState("note");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convName, setConvName] = useState("");

  const reload = () => { void detail.refetch(); onChanged(); };

  const addActivity = async () => {
    if (!noteBody.trim()) return;
    setBusy(true);
    try {
      await api.addEnquiryActivity(id, {
        type: noteType,
        body: noteBody.trim(),
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      });
      setNoteBody(""); setDueAt(""); setNoteType("note");
      reload();
    } finally { setBusy(false); }
  };

  const completeTask = async (actId: string) => {
    await api.completeEnquiryTask(id, actId);
    reload();
  };

  const setStage = async (stage: EnquiryStage) => {
    if (!e) return;
    if (stage === "lost") {
      const reason = window.prompt("Reason for marking lost?") ?? undefined;
      await api.setEnquiryStage(id, stage, reason);
    } else {
      await api.setEnquiryStage(id, stage);
    }
    reload();
  };

  const doConvert = async () => {
    setBusy(true);
    try {
      await api.convertEnquiry(id, { name: convName || undefined, markWon: true });
      setConverting(false);
      reload();
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm("Delete this enquiry permanently?")) return;
    await api.deleteEnquiry(id);
    onClose();
    onChanged();
  };

  return (
    <div className="fixed inset-0 z-[60] bg-ink/40 flex justify-end" {...backdropDismissProps(onClose)}>
      <div className="bg-surface w-full max-w-2xl flex flex-col elevation-3" onClick={(ev) => ev.stopPropagation()}>
        {!e ? (
          <div className="p-10 text-center text-ink-muted">{detail.loading ? "Loading…" : "Not found"}</div>
        ) : (
          <>
            {/* header */}
            <div className="px-5 py-3 border-b border-border flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-caption font-mono text-ink-muted">{e.enquiryNo}</span>
                  <span className={cn("text-[10px] rounded-full px-1.5 py-0.5 border", TYPE_META[e.type].cls)}>{TYPE_META[e.type].label}</span>
                  <span className={cn("text-[10px] rounded px-1.5 py-0.5", PRIORITY_META[e.priority]?.cls)}>{PRIORITY_META[e.priority]?.label}</span>
                </div>
                <div className="text-h3 font-bold mt-0.5 line-clamp-2">{e.subject}</div>
              </div>
              <button onClick={onClose} className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas shrink-0">
                <X size={18} />
              </button>
            </div>

            {/* stage stepper */}
            <div className="px-5 py-2.5 border-b border-border flex items-center gap-1 flex-wrap bg-canvas/40">
              {STAGES.map((st) => (
                <button
                  key={st.id}
                  onClick={() => setStage(st.id)}
                  className={cn(
                    "text-caption px-2.5 py-1 rounded-full border font-medium transition",
                    e.stage === st.id
                      ? "bg-primary text-white border-primary"
                      : "bg-surface text-ink-muted border-border hover:border-primary/50"
                  )}
                >
                  {st.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* contact + meta */}
              <section className="px-5 py-3 grid grid-cols-2 gap-x-4 gap-y-2 text-body-sm border-b border-border">
                <Meta label="Contact" value={e.contactName} />
                <Meta label="Company" value={e.company || "—"} />
                <Meta label="Phone" value={e.phone || "—"} icon={<Phone size={12} />} />
                <Meta label="Email" value={e.email || "—"} />
                <Meta label="City" value={e.city || "—"} />
                <Meta label="Source" value={e.source.replace("_", " ")} />
                <Meta label="Est. value" value={e.estimatedValue > 0 ? inr(e.estimatedValue) : "—"} />
                <Meta label="Customer" value={e.customer ? `${e.customer.name} (${e.customer.code})` : "Not linked"} icon={e.customer ? <Building2 size={12} /> : undefined} />
              </section>

              {e.requirement && (
                <section className="px-5 py-3 border-b border-border">
                  <div className="text-caption text-ink-muted uppercase tracking-wide mb-1">Requirement</div>
                  <p className="text-body-sm whitespace-pre-wrap">{e.requirement}</p>
                </section>
              )}

              {/* items */}
              {e.items && e.items.length > 0 && (
                <section className="px-5 py-3 border-b border-border">
                  <div className="text-caption text-ink-muted uppercase tracking-wide mb-1.5">Interested in</div>
                  <div className="space-y-1">
                    {e.items.map((it) => (
                      <div key={it.id} className="flex items-center justify-between text-body-sm bg-canvas rounded px-2 py-1">
                        <span>{it.product ? `${it.product.name}${it.variant ? ` · ${it.variant.sku}` : ""}` : it.description || "Item"}</span>
                        <span className="tnum text-ink-muted">×{it.qty}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* convert */}
              <section className="px-5 py-3 border-b border-border">
                {e.customer ? (
                  <div className="flex items-center gap-2 text-body-sm text-success">
                    <CheckCircle2 size={16} /> Linked to customer {e.customer.code}
                  </div>
                ) : converting ? (
                  <div className="space-y-2">
                    <Input size="sm" label="New customer name" value={convName} onChange={(ev) => setConvName(ev.target.value)} placeholder={e.company || e.contactName} />
                    <div className="flex gap-2">
                      <Button size="sm" loading={busy} icon={<UserPlus size={14} />} onClick={doConvert}>Create customer</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConverting(false)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" icon={<UserPlus size={14} />} onClick={() => { setConvName(e.company || e.contactName); setConverting(true); }}>
                    Convert to customer
                  </Button>
                )}
              </section>

              {/* activity composer */}
              <section className="px-5 py-3 border-b border-border space-y-2">
                <div className="text-caption text-ink-muted uppercase tracking-wide">Log activity / schedule follow-up</div>
                <div className="flex gap-2">
                  <select value={noteType} onChange={(ev) => setNoteType(ev.target.value)} className="h-9 px-2 rounded-md border border-border bg-surface text-body-sm">
                    {["note", "call", "email", "meeting", "whatsapp", "visit"].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input
                    type="datetime-local"
                    value={dueAt}
                    onChange={(ev) => setDueAt(ev.target.value)}
                    title="Optional: set a follow-up due date to create a task"
                    className="h-9 px-2 rounded-md border border-border bg-surface text-body-sm"
                  />
                </div>
                <textarea
                  value={noteBody}
                  onChange={(ev) => setNoteBody(ev.target.value)}
                  placeholder="What happened / what to do next…"
                  rows={2}
                  className="w-full px-3 py-2 rounded-md border border-border bg-surface text-body-sm resize-y"
                />
                <Button size="sm" loading={busy} onClick={addActivity} disabled={!noteBody.trim()}>
                  {dueAt ? "Add task" : "Add note"}
                </Button>
              </section>

              {/* timeline */}
              <section className="px-5 py-3">
                <div className="text-caption text-ink-muted uppercase tracking-wide mb-2">Timeline</div>
                <div className="space-y-2">
                  {(e.activities ?? []).map((a) => (
                    <ActivityRow key={a.id} a={a} onComplete={() => completeTask(a.id)} />
                  ))}
                  {(e.activities ?? []).length === 0 && (
                    <div className="text-body-sm text-ink-muted">No activity yet.</div>
                  )}
                </div>
              </section>
            </div>

            <div className="border-t border-border px-5 py-2.5 flex justify-between">
              <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={remove} className="text-danger">Delete</Button>
              <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const Meta = ({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) => (
  <div>
    <div className="text-caption text-ink-muted uppercase tracking-wide">{label}</div>
    <div className="font-medium flex items-center gap-1">{icon}{value}</div>
  </div>
);

const ActivityRow = ({ a, onComplete }: { a: EnquiryActivity; onComplete: () => void }) => {
  const isTask = !!a.dueAt;
  const done = !!a.completedAt;
  const overdue = isTask && !done && new Date(a.dueAt!) <= new Date();
  return (
    <div className={cn("rounded-md border px-3 py-2", overdue ? "border-danger/30 bg-danger/5" : "border-border bg-canvas/40")}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-caption">
          <span className="uppercase font-semibold text-ink-muted">{a.type.replace("_", " ")}</span>
          {isTask && (
            <span className={cn("rounded-full px-1.5 py-0.5", done ? "bg-success-soft text-success" : overdue ? "bg-danger/10 text-danger" : "bg-warning-soft text-[#8a6300]")}>
              {done ? "done" : `due ${dd(a.dueAt!)}`}
            </span>
          )}
        </div>
        <span className="text-caption text-ink-muted">{dd(a.createdAt)}</span>
      </div>
      <p className="text-body-sm mt-1 whitespace-pre-wrap">{a.body}</p>
      {a.outcome && <p className="text-caption text-ink-muted mt-0.5">Outcome: {a.outcome}</p>}
      <div className="flex items-center justify-between mt-1">
        <span className="text-caption text-ink-muted">{a.createdBy?.name ?? ""}</span>
        {isTask && !done && (
          <button onClick={onComplete} className="text-caption text-primary hover:underline flex items-center gap-1">
            <CheckCircle2 size={12} /> Mark done
          </button>
        )}
      </div>
    </div>
  );
};

// ─── New enquiry modal ─────────────────────────────────────────────────────
const emptyEnquiry = (): EnquiryInput => ({
  type: "product",
  source: "walk_in",
  priority: "medium",
  contactName: "",
  phone: "",
  email: "",
  company: "",
  city: "",
  subject: "",
  requirement: "",
  estimatedValue: 0,
});

const NewEnquiryModal = ({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) => {
  const [form, setForm] = useState<EnquiryInput>(emptyEnquiry());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof EnquiryInput>(k: K, v: EnquiryInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.contactName.trim() || !form.subject.trim()) {
      setError("Contact name and subject are required.");
      return;
    }
    setBusy(true); setError(null);
    try {
      await api.createEnquiry({
        ...form,
        email: form.email || null,
        phone: form.phone || null,
        company: form.company || null,
        city: form.city || null,
        requirement: form.requirement || null,
      });
      onCreated();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-ink/40 flex items-center justify-center p-4" {...backdropDismissProps(onClose)}>
      <div className="bg-surface w-full max-w-xl rounded-lg elevation-3 flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="text-h3 font-bold">New enquiry</div>
          <button onClick={onClose} className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Select label="Type" value={form.type!} onChange={(v) => set("type", v as EnquiryType)} options={TYPE_OPTIONS.map((t) => [t, TYPE_META[t].label])} />
            <Select label="Source" value={form.source!} onChange={(v) => set("source", v as EnquiryInput["source"])} options={SOURCE_OPTIONS.map((sx) => [sx, sx.replace("_", " ")])} />
            <Select label="Priority" value={form.priority!} onChange={(v) => set("priority", v as EnquiryInput["priority"])} options={[["low", "Low"], ["medium", "Medium"], ["high", "High"]]} />
          </div>
          <Input label="Subject *" value={form.subject} onChange={(e) => set("subject", e.target.value)} placeholder="e.g. Bulk groundnut oil for dealership" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Contact name *" value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
            <Input label="Company" value={form.company ?? ""} onChange={(e) => set("company", e.target.value)} />
            <Input label="Phone" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
            <Input label="Email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
            <Input label="City" value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} />
            <Input label="Est. value (₹)" type="number" value={String(form.estimatedValue ?? 0)} onChange={(e) => set("estimatedValue", Number(e.target.value))} />
          </div>
          <div>
            <span className="text-caption font-medium">Requirement</span>
            <textarea
              value={form.requirement ?? ""}
              onChange={(e) => set("requirement", e.target.value)}
              rows={3}
              className="w-full mt-1 px-3 py-2 rounded-md border border-border bg-surface text-body-sm resize-y"
              placeholder="Describe what the lead is looking for…"
            />
          </div>
          {error && <div className="text-body-sm text-danger">{error}</div>}
        </div>
        <div className="border-t border-border px-5 py-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={submit}>Create enquiry</Button>
        </div>
      </div>
    </div>
  );
};

const Select = ({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) => (
  <label className="flex flex-col gap-1.5">
    <span className="text-caption font-medium text-ink">{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-10 px-2 rounded-md border border-border bg-surface text-body">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </label>
);
