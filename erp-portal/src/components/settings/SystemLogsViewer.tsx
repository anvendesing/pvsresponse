import { useCallback, useEffect, useState, Fragment } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { api, apiEnabled, type PaymentIntentRow, type SystemEventLogRow, type SystemLogSummary } from "@/lib/api";
import { cn } from "@/lib/cn";

const LEVEL_TONE: Record<string, "danger" | "warning" | "neutral" | "success"> = {
  error: "danger",
  warn: "warning",
  info: "neutral",
};

const SOURCES = ["", "storefront", "shiprocket", "razorpay", "payu", "otp", "sms", "billing"] as const;
const LEVELS = ["", "error", "warn", "info"] as const;

export const SystemLogsViewer = () => {
  const [rows, setRows] = useState<SystemEventLogRow[]>([]);
  const [summary, setSummary] = useState<SystemLogSummary | null>(null);
  const [payments, setPayments] = useState<PaymentIntentRow[]>([]);
  const [loading, setLoading] = useState(apiEnabled);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [level, setLevel] = useState("");
  const [q, setQ] = useState("");
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

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <Card
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
      </Card>

      <Card title="Recent payment intents" subtitle="Razorpay checkout sessions — useful when order confirm fails after payment.">
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
      </Card>
    </div>
  );
};
