import { useNavigate } from "react-router-dom";
import { Pin, Plus, X } from "lucide-react";
import * as Icons from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { cn } from "@/lib/cn";

export const WorkspaceTabs = ({ onNewTab }: { onNewTab: () => void }) => {
  const { tabs, activeId, activate, closeTab } = useWorkspace();
  const navigate = useNavigate();

  return (
    <div className="h-10 bg-canvas border-b border-border flex items-end px-1.5 overflow-x-auto shrink-0">
      <div className="flex items-end gap-0.5 h-full">
        {tabs.map((t) => {
          const IconComp = (t.icon && (Icons as Record<string, unknown>)[t.icon]) as
            | typeof Icons.LayoutDashboard
            | undefined;
          const active = activeId === t.id;
          return (
            <div
              key={t.id}
              onClick={() => {
                activate(t.id);
                navigate(t.path);
              }}
              className={cn(
                "group h-9 flex items-center gap-2 pl-3 pr-1.5 rounded-t-md cursor-pointer min-w-[120px] max-w-[220px] text-body-sm font-medium transition-colors border-x border-t",
                active
                  ? "bg-surface text-primary border-border shadow-[0_-1px_0_#003087_inset]"
                  : "bg-canvas text-ink-muted border-transparent hover:bg-surface/60 hover:text-ink"
              )}
            >
              {t.pinned ? (
                <Pin size={12} className="shrink-0 text-ink-muted" />
              ) : (
                IconComp && <IconComp size={14} className="shrink-0" />
              )}
              <span className="truncate flex-1">{t.title}</span>
              {!t.pinned && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(t.id);
                  }}
                  className="shrink-0 h-5 w-5 grid place-items-center rounded hover:bg-canvas text-ink-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        onClick={onNewTab}
        className="h-9 w-9 mx-1 grid place-items-center rounded-md text-ink-muted hover:bg-surface hover:text-primary transition-colors"
        title="New tab (Ctrl+T)"
      >
        <Plus size={16} />
      </button>
    </div>
  );
};
