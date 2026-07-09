import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Building2,
  Clock,
  LogOut,
  PanelLeft,
  ScanLine,
  Search,
  Sparkles,
  User,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { useBrand } from "@/hooks/useBrand";

interface Props {
  onToggleSidebar: () => void;
  onOpenPalette: () => void;
  onOpenScanner: () => void;
  onSignOut: () => void;
  warehouse: string;
  shift: string;
  user: { name: string; role: string; username?: string };
  notifications: number;
}

export const TopCommandBar = ({
  onToggleSidebar,
  onOpenPalette,
  onOpenScanner,
  onSignOut,
  warehouse,
  shift,
  user,
  notifications,
}: Props) => {
  const { brandName, logoUrl } = useBrand();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    let downOutside = false;
    const onDocDown = (e: MouseEvent) => {
      downOutside = !!(menuRef.current && !menuRef.current.contains(e.target as Node));
    };
    const onDocUp = (e: MouseEvent) => {
      if (downOutside && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      downOutside = false;
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("mouseup", onDocUp);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("mouseup", onDocUp);
    };
  }, [menuOpen]);
  // First letter of the brand drives the monogram tile when no logo
  // has been uploaded - keeps the chrome looking branded immediately
  // after a name change without forcing the user to upload a logo.
  const monogram = (brandName?.trim()?.[0] ?? "N").toUpperCase();
  return (
    <header className="h-14 bg-surface border-b border-border flex items-center px-3 gap-3 shrink-0">
      <button
        onClick={onToggleSidebar}
        className="h-9 w-9 flex items-center justify-center rounded-md text-ink-muted hover:bg-canvas hover:text-primary transition-colors"
        title="Toggle navigation"
      >
        <PanelLeft size={18} />
      </button>

      <div className="flex items-center gap-2 pr-3 mr-1 border-r border-border">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={brandName}
            className="h-8 w-8 rounded-md object-contain bg-white border border-border"
          />
        ) : (
          <div className="h-8 w-8 rounded-md bg-primary text-white grid place-items-center font-bold tracking-tight">
            {monogram}
          </div>
        )}
        <div className="leading-tight">
          <div className="text-body font-bold text-ink truncate max-w-[160px]" title={brandName}>
            {brandName}
          </div>
          <div className="text-[10px] text-ink-muted -mt-0.5 uppercase tracking-wider">
            Manufacturing
          </div>
        </div>
      </div>

      <button
        onClick={onOpenPalette}
        className="h-9 flex-1 max-w-[640px] flex items-center gap-2 px-3 rounded-md bg-canvas border border-border hover:border-primary hover:bg-white transition-colors text-ink-muted text-body-sm group"
      >
        <Search size={16} />
        <span className="flex-1 text-left">Search products, bins, invoices, workers, orders…</span>
        <span className="kbd">Ctrl</span>
        <span className="kbd">K</span>
      </button>

      <Button
        variant="secondary"
        size="md"
        icon={<ScanLine size={16} />}
        onClick={onOpenScanner}
        className="!h-9 !text-body-sm"
      >
        Scan
      </Button>

      <div className="hidden lg:flex items-center gap-2 pl-3 ml-1 border-l border-border">
        <Chip tone="primary" size="sm" icon={<Building2 size={12} />}>
          {warehouse}
        </Chip>
        <Chip tone="info" size="sm" icon={<Clock size={12} />}>
          Shift {shift}
        </Chip>
      </div>

      <div className="flex items-center gap-1 ml-auto pl-2">
        <button
          className="h-9 w-9 flex items-center justify-center rounded-md text-ink-muted hover:bg-canvas hover:text-primary transition-colors"
          title="AI Insights"
        >
          <Sparkles size={18} />
        </button>
        <button
          className="relative h-9 w-9 flex items-center justify-center rounded-md text-ink-muted hover:bg-canvas hover:text-primary transition-colors"
          title="Notifications"
        >
          <Bell size={18} />
          {notifications > 0 && (
            <span className="absolute top-1.5 right-1.5 h-4 min-w-[16px] px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center">
              {notifications}
            </span>
          )}
        </button>
        <div className="relative ml-1 pl-2 border-l border-border" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-9 items-center gap-2 rounded-md px-1 hover:bg-canvas transition-colors"
            title="Account · sign out"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <div className="h-8 w-8 rounded-full bg-primary-50 text-primary grid place-items-center">
              <User size={16} />
            </div>
            <div className="hidden md:flex flex-col leading-tight pr-1 text-left">
              <span className="text-caption font-semibold text-ink">{user.name}</span>
              <span className="text-[10px] text-ink-muted capitalize">{user.role}</span>
            </div>
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-surface py-1 shadow-lg"
            >
              <div className="border-b border-border px-3 py-2">
                <div className="text-caption font-semibold text-ink">{user.name}</div>
                {user.username && (
                  <div className="text-[10px] text-ink-muted">{user.username}</div>
                )}
                <div className="text-[10px] capitalize text-ink-muted">{user.role}</div>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onSignOut();
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-body-sm text-ink hover:bg-canvas"
              >
                <LogOut size={16} className="text-ink-muted" />
                Sign out · Switch user
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
