// UserManager — real user list + create/edit/deactivate UI.
// Rendered inside Settings → "Users & Roles" (admin only).

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Edit2,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Trash2,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { api, apiEnabled, type ApiUser } from "@/lib/api";
import { cn } from "@/lib/cn";

const ROLE_META: Record<string, { label: string; tone: "primary" | "warning" | "info" | "success" | "danger" | "neutral"; desc: string }> = {
  admin:       { label: "Admin",               tone: "danger",  desc: "Full access to all modules and settings" },
  supervisor:  { label: "Supervisor",           tone: "warning", desc: "Sales orders, picking, packing, manufacturing, approvals, reports" },
  billing:     { label: "Billing / Office",     tone: "primary", desc: "Customers, quotes, sales orders, billing, returns, reports" },
  procurement: { label: "Procurement",          tone: "info",    desc: "Products, procurement, price lists, inventory" },
  warehouse:   { label: "Warehouse",            tone: "success", desc: "Picking, packing, returns, inventory, warehouse" },
  worker:      { label: "Worker",               tone: "neutral", desc: "Warehouse mobile PWA only (scanning, tasks)" },
};

type UserRow = ApiUser;

interface FormState {
  username: string;
  name: string;
  role: string;
  email: string;
  password: string;
  pin: string;
}

const EMPTY_FORM: FormState = {
  username: "",
  name: "",
  role: "billing",
  email: "",
  password: "",
  pin: "",
};

export const UserManager = () => {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(apiEnabled);
  const [editUser, setEditUser] = useState<UserRow | null>(null); // null = create mode
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPwd, setShowPwd] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const loadUsers = async () => {
    if (!apiEnabled) return;
    setLoading(true);
    try {
      const rows = await api.users();
      setUsers(rows as UserRow[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadUsers(); }, []);

  useEffect(() => {
    if (modalOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [modalOpen]);

  const openCreate = () => {
    setEditUser(null);
    setForm(EMPTY_FORM);
    setError(null);
    setShowPwd(false);
    setModalOpen(true);
  };

  const openEdit = (u: UserRow) => {
    setEditUser(u);
    setForm({ username: u.username, name: u.name, role: u.role, email: u.email ?? "", password: "", pin: "" });
    setError(null);
    setShowPwd(false);
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { setError("Name is required."); return; }
    if (!editUser && !form.password) { setError("Password is required for new users."); return; }
    if (form.pin && !/^\d{6}$/.test(form.pin)) { setError("PIN must be exactly 6 digits."); return; }
    if (!editUser && form.password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setBusy(true);
    setError(null);
    try {
      if (editUser) {
        await api.updateUser(editUser.id, {
          name: form.name.trim(),
          role: form.role,
          email: form.email.trim() || null,
          password: form.password || null,
          pin: form.pin || null,
        });
        setBanner(`User "${form.name}" updated.`);
      } else {
        await api.createUser({
          username: form.username.trim(),
          name: form.name.trim(),
          role: form.role,
          email: form.email.trim() || null,
          password: form.password,
          pin: form.pin || null,
        });
        setBanner(`User "${form.name}" created.`);
      }
      setModalOpen(false);
      void loadUsers();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (u: UserRow) => {
    const label = u.active ? "deactivate" : "reactivate";
    if (!window.confirm(`Are you sure you want to ${label} "${u.name}"?`)) return;
    setBusy(true);
    try {
      await api.updateUser(u.id, { active: !u.active });
      setBanner(`${u.name} ${u.active ? "deactivated" : "reactivated"}.`);
      void loadUsers();
    } catch (e) {
      setBanner(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const filtered = filterRole ? users.filter((u) => u.role === filterRole) : users;
  const roleCounts = Object.fromEntries(
    Object.keys(ROLE_META).map((r) => [r, users.filter((u) => u.role === r).length])
  );

  return (
    <div className="space-y-4">
      {/* Summary chips by role */}
      <Card title="Roles" noPadding>
        <div className="divide-y divide-border">
          {Object.entries(ROLE_META).map(([r, meta]) => (
            <button
              key={r}
              onClick={() => setFilterRole(filterRole === r ? "" : r)}
              className={cn(
                "w-full px-4 py-3 flex items-center gap-3 text-left transition-colors",
                filterRole === r ? "bg-primary-50" : "hover:bg-canvas"
              )}
            >
              <div className="flex-1">
                <div className="font-semibold text-body-sm">{meta.label}</div>
                <div className="text-caption text-ink-muted">{meta.desc}</div>
              </div>
              <Chip tone={meta.tone} size="sm">{roleCounts[r] ?? 0} user{(roleCounts[r] ?? 0) !== 1 ? "s" : ""}</Chip>
              {filterRole === r && <Check size={14} className="text-primary" />}
            </button>
          ))}
        </div>
      </Card>

      {/* Users list */}
      <Card
        title={filterRole ? `${ROLE_META[filterRole]?.label ?? filterRole} users` : "All users"}
        actions={
          <Button size="sm" icon={<Plus size={14} />} onClick={openCreate}>
            New user
          </Button>
        }
        noPadding
      >
        {banner && (
          <div className="px-4 py-2 bg-success-soft border-b border-success/40 text-body-sm text-ink flex items-center gap-2">
            <Check size={14} className="text-success" />
            <span className="flex-1">{banner}</span>
            <button className="text-caption text-ink-muted hover:text-ink" onClick={() => setBanner(null)}>dismiss</button>
          </div>
        )}
        {loading ? (
          <div className="p-8 text-center text-ink-muted flex items-center justify-center gap-2">
            <Loader2 size={18} className="animate-spin text-primary" />
            <span className="text-body-sm">Loading users…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-ink-muted text-body-sm">No users found.</div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((u) => {
              const meta = ROLE_META[u.role];
              return (
                <div
                  key={u.id}
                  className={cn("px-4 py-3 flex items-center gap-3", !u.active && "opacity-50")}
                >
                  {/* Avatar monogram */}
                  <div className={cn(
                    "h-8 w-8 rounded-full grid place-items-center font-bold text-caption shrink-0",
                    "bg-primary text-white"
                  )}>
                    {u.name.trim()[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-body-sm">{u.name}</span>
                      {!u.active && <Chip tone="neutral" size="sm">Inactive</Chip>}
                      <Chip tone={meta?.tone ?? "neutral"} size="sm">{meta?.label ?? u.role}</Chip>
                    </div>
                    <div className="text-caption text-ink-muted flex items-center gap-2 flex-wrap mt-0.5">
                      <span className="font-mono">@{u.username}</span>
                      {u.email && <span>· {u.email}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Edit"
                      onClick={() => openEdit(u)}
                    >
                      <Edit2 size={13} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={u.active ? "Deactivate" : "Reactivate"}
                      disabled={busy}
                      onClick={() => toggleActive(u)}
                      className={u.active ? "text-danger" : "text-success"}
                    >
                      {u.active ? <UserX size={13} /> : <UserCheck size={13} />}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Create / Edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-surface rounded-xl shadow-xl w-full max-w-md mx-4 flex flex-col">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-canvas rounded-t-xl">
              <div className="flex-1 font-semibold text-body-sm text-ink-strong">
                {editUser ? `Edit user — ${editUser.username}` : "New user"}
              </div>
              <button onClick={() => setModalOpen(false)} className="h-7 w-7 grid place-items-center rounded text-ink-muted hover:bg-surface-hover">
                <X size={14} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3 overflow-y-auto max-h-[70vh]">
              {!editUser && (
                <Field label="Username *">
                  <input
                    ref={inputRef}
                    type="text"
                    value={form.username}
                    onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.toLowerCase() }))}
                    placeholder="e.g. ravi.sharma"
                    className="w-full border border-border rounded-md px-3 py-2 text-body-sm bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </Field>
              )}

              <Field label="Full name *">
                <input
                  ref={editUser ? inputRef : undefined}
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Ravi Sharma"
                  className="w-full border border-border rounded-md px-3 py-2 text-body-sm bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </Field>

              <Field label="Role *">
                <select
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  className="w-full border border-border rounded-md px-3 py-2 text-body-sm bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {Object.entries(ROLE_META).map(([r, m]) => (
                    <option key={r} value={r}>{m.label}</option>
                  ))}
                </select>
                <div className="text-caption text-ink-muted mt-1">{ROLE_META[form.role]?.desc}</div>
              </Field>

              <Field label="Email">
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="e.g. ravi@example.com"
                  className="w-full border border-border rounded-md px-3 py-2 text-body-sm bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </Field>

              <Field label={editUser ? "New password (leave blank to keep current)" : "Password *"}>
                <div className="relative">
                  <input
                    type={showPwd ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder={editUser ? "••••••••" : "Min. 6 characters"}
                    className="w-full border border-border rounded-md px-3 py-2 text-body-sm bg-surface focus:outline-none focus:ring-1 focus:ring-primary pr-9"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
                    onClick={() => setShowPwd((v) => !v)}
                  >
                    {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </Field>

              <Field label="PIN (6 digits, for warehouse mobile login — optional)">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={form.pin}
                  onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                  placeholder="e.g. 123456"
                  className="w-full border border-border rounded-md px-3 py-2 text-body-sm bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </Field>

              {error && (
                <div className="flex items-start gap-2 text-danger text-body-sm bg-danger-soft border border-danger/30 rounded-md p-3">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-canvas rounded-b-xl">
              <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={busy}>
                {busy ? <Loader2 size={13} className="animate-spin mr-1" /> : null}
                {editUser ? "Save changes" : "Create user"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1">
    <label className="text-body-sm font-semibold text-ink">{label}</label>
    {children}
  </div>
);
