import { useCallback, useEffect, useState, Fragment } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { api, apiEnabled, type CustomerActivityRow, type PaymentIntentRow, type SystemEventLogRow, type SystemLogSummary } from "@/lib/api";
import { cn } from "@/lib/cn";

type Tab = "logs" | "payments" | "activity";

const LEVEL_TONE: Record<string, "danger" | "warning" | "neutral" | "success"> = {
  error: "danger",
  warn: "warning",
  info: "neutral",
};

const SOURCES = ["", "storefront", "shiprocket", "razorpay", "payu", "otp", "sms", "billing"] as const;
const LEVELS = ["", "error", "warn", "info"] as const;

const EVENT_TYPES = ["", "pageview", "product_view", "add_to_cart", "remove_from_cart", "begin_checkout", "place_order", "login", "logout", "search"] as const;

export const SystemLogsViewer = () => {
  const [tab, setTab] = useState<Tab>("logs");
  const [rows, setRows] = useState<SystemEventLogRow[]>([]);
  const [summary, setSummary] = useState<SystemLogSummary | null>(null);
  const [payments, setPayments] = useState<PaymentIntentRow[]>([]);
  const [activityRows, setActivityRows] = useState<CustomerActivityRow[]>([]);
  const [loading, setLoading] = useState(apiEnabled);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [level, setLevel] = useState("");
  const [q, setQ] = useState("");
  const [actEvent, setActEvent] = useState("");
  const [actCustomerId, setActCustomerId] = useState("");
  const [actAnonId, setActAnonId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!apiEnabled) return;
    setLoading(true);
    setError(null);
    try {
      const [logRes, sumRes, payRes] = await Promise.all([
        api.systemLogs({
          source: source || undefined,
          level: (level || undefined) as "error" | "warn" | "info" | undefined,
          q: q.trim() || undefined,
          limit: 80,
        }),
        api.systemLogSummary(),
        api.paymentIntents({ limit: 20 }),
      ]);
      setRows(logRes.rows);
      setSummary(sumRes);
      setPayments(payRes.rows);
    } catch (e) {
      setError((e as Error).message ?? "Could not load system logs.");
    } finally {
      setLoading(false);
    }
  }, [source, level, q]);

  const loadActivity = useCallback(async () => {
    if (!apiEnabled) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.customerActivity({
        event: actEvent || undefined,
        customerId: actCustomerId.trim() || undefined,
        anonId: actAnonId.trim() || undefined,
        limit: 100,
      });
      setActivityRows(res.rows);
    } catch (e) {
      setError((e as Error).message ?? "Could not load customer activity.");
    } finally {
      setLoading(false);
    }
  }, [actEvent, actCustomerId, actAnonId]);

  useEffect(() => {
    if (tab === "activity") void loadActivity();
    else void load();
  }, [tab, load, loadActivity]);

  const EVENT_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
    place_order: "success",
    login: "success",
    add_to_cart: "neutral",
    begin_checkout: "warning",
    logout: "neutral",
    pageview: "neutral",
    search: "neutral",
    product_view: "neutral",
    remove_from_cart: "danger",
  };

  return (
    <div className="space-y-4">
      {/* ── Tab strip ─────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-border mb-2">
        {(["logs", "payments", "activity"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-body-sm font-medium capitalize rounded-t-md border border-b-0 border-transparent transition-colors",
              tab === t
                ? "border-border bg-surface text-ink"
                : "text-ink-muted hover:text-ink"
            )}
          >
            {t === "activity" ? "Customer activity" : t === "payments" ? "Payment intents" : "System logs"}
          </button>
        ))}
      </div>

      {tab === "logs" && <Card
        title="System logs"
        subtitle="Storefront, Shiprocket, Razorpay, OTP/SMS — admin only. Secrets are redacted automatically."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </Button>
        }
      >
        {error && (
          <div className="mb-3 flex items-center gap-2 text-body-sm text-danger">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            {summary.counts.map((c) => (
              <div key={`${c.source}-${c.level}`} className="rounded-md border border-border px-3 py-2">
                <div className="text-caption text-ink-muted uppercase">{c.source}</div>
                <div className="flex items-center gap-2 mt-1">
                  <Chip tone={LEVEL_TONE[c.level] ?? "neutral"}>{c.level}</Chip>
                  <span className="font-semibold tabular-nums">{c.count}</span>
                  <span className="text-caption text-ink-muted">24h</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
          <label className="text-body-sm">
            <span className="block text-caption text-ink-muted mb-1">Source</span>
            <select
              className="w-full h-9 rounded-md border border-border px-2 bg-surface"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              {SOURCES.map((s) => (
                <option key={s || "all"} value={s}>
                  {s || "All sources"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-body-sm">
            <span className="block text-caption text-ink-muted mb-1">Level</span>
            <select
              className="w-full h-9 rounded-md border border-border px-2 bg-surface"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            >
              {LEVELS.map((l) => (
                <option key={l || "all"} value={l}>
                  {l || "All levels"}
                </option>
              ))}
            </select>
          </label>
          <div className="md:col-span-2">
            <Input
              label="Search message / ref"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="SO-2026, intent id, pincode…"
            />
          </div>
        </div>

        <div className="overflow-x-auto border border-border rounded-md">
          <table className="w-full text-body-sm">
            <thead className="bg-canvas text-caption uppercase text-ink-muted">
              <tr>
                <th className="text-left px-3 py-2">Time</th>
                <th className="text-left px-3 py-2">Level</th>
                <th className="text-left px-3 py-2">Source</th>
                <th className="text-left px-3 py-2">Action</th>
                <th className="text-left px-3 py-2">Message</th>
                <th className="text-left px-3 py-2">Ref</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr
                    className={cn("border-t border-border hover:bg-canvas cursor-pointer")}
                    onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  >
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums text-caption">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <Chip tone={LEVEL_TONE[r.level] ?? "neutral"}>{r.level}</Chip>
                    </td>
                    <td className="px-3 py-2">{r.source}</td>
                    <td className="px-3 py-2 font-mono text-caption">{r.action}</td>
                    <td className="px-3 py-2 max-w-md truncate">{r.message}</td>
                    <td className="px-3 py-2 font-mono text-caption">{r.refId ?? "—"}</td>
                  </tr>
                  {expandedId === r.id && r.context != null ? (
                    <tr className="border-t border-border bg-canvas">
                      <td colSpan={6} className="px-3 py-2">
                        <pre className="text-caption overflow-x-auto whitespace-pre-wrap font-mono">
                          {JSON.stringify(r.context, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-ink-muted">
                    No log entries yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>}

      {tab === "payments" && <Card title="Recent payment intents" subtitle="Razorpay / PayU checkout sessions — useful when order confirm fails after payment.">
        <div className="overflow-x-auto border border-border rounded-md">
          <table className="w-full text-body-sm">
            <thead className="bg-canvas text-caption uppercase text-ink-muted">
              <tr>
                <th className="text-left px-3 py-2">Created</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Amount</th>
                <th className="text-left px-3 py-2">Phone</th>
                <th className="text-left px-3 py-2">Gateway order</th>
                <th className="text-left px-3 py-2">SO</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2 text-caption tabular-nums">
                    {new Date(p.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <Chip tone={p.status === "paid" ? "success" : p.status === "failed" ? "danger" : "neutral"}>
                      {p.status}
                    </Chip>
                  </td>
                  <td className="px-3 py-2 tabular-nums">₹{p.amount.toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2">{p.phone ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-caption truncate max-w-[140px]">{p.gatewayOrderId}</td>
                  <td className="px-3 py-2 font-mono text-caption">{p.salesOrderId ? "linked" : "—"}</td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-ink-muted">
                    No payment intents recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>}

      {tab === "activity" && (
        <Card
          title="Customer activity"
          subtitle="Storefront visitor events — pageviews, add-to-cart, orders, logins. Anonymous visitors included via anonId."
          actions={
            <Button variant="secondary" size="sm" onClick={() => void loadActivity()} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Refresh
            </Button>
          }
        >
          {error && (
            <div className="mb-3 flex items-center gap-2 text-body-sm text-danger">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
            <label className="text-body-sm">
              <span className="block text-caption text-ink-muted mb-1">Event type</span>
              <select
                className="w-full h-9 rounded-md border border-border px-2 bg-surface"
                value={actEvent}
                onChange={(e) => setActEvent(e.target.value)}
              >
                {EVENT_TYPES.map((ev) => (
                  <option key={ev || "all"} value={ev}>{ev || "All events"}</option>
                ))}
              </select>
            </label>
            <div>
              <Input
                label="Customer ID"
                value={actCustomerId}
                onChange={(e) => setActCustomerId(e.target.value)}
                placeholder="cust_…"
              />
            </div>
            <div>
              <Input
                label="Anon ID"
                value={actAnonId}
                onChange={(e) => setActAnonId(e.target.value)}
                placeholder="xxxxxxxx-…"
              />
            </div>
            <div className="flex items-end">
              <Button size="sm" variant="secondary" onClick={() => void loadActivity()} disabled={loading} className="w-full">
                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                Search
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto border border-border rounded-md">
            <table className="w-full text-body-sm">
              <thead className="bg-canvas text-caption uppercase text-ink-muted">
                <tr>
                  <th className="text-left px-3 py-2">Time</th>
                  <th className="text-left px-3 py-2">Event</th>
                  <th className="text-left px-3 py-2">Anon ID</th>
                  <th className="text-left px-3 py-2">Customer ID</th>
                  <th className="text-left px-3 py-2">Path / Product</th>
                  <th className="text-left px-3 py-2">IP</th>
                </tr>
              </thead>
              <tbody>
                {activityRows.map((r) => (
                  <tr key={r.id} className="border-t border-border hover:bg-canvas">
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums text-caption">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <Chip tone={EVENT_TONE[r.event] ?? "neutral"}>{r.event}</Chip>
                    </td>
                    <td className="px-3 py-2 font-mono text-caption" title={r.anonId}>
                      {r.anonId.slice(0, 8)}…
                    </td>
                    <td className="px-3 py-2 font-mono text-caption">
                      {r.customerId ? r.customerId.slice(0, 10) + "…" : <span className="text-ink-muted">anon</span>}
                    </td>
                    <td className="px-3 py-2 max-w-[220px] truncate text-caption">
                      {r.path ?? r.productId ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-caption text-ink-muted">{r.ip ?? "—"}</td>
                  </tr>
                ))}
                {!loading && activityRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-ink-muted">
                      No activity recorded yet. Visit the storefront to generate events.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};
