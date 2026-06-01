import { Link } from "react-router-dom";
import { ArrowRightLeft, Settings } from "lucide-react";
import { Toolbar } from "@/components/common/Toolbar";
import { PutawayRulesManager } from "@/pages/Settings";

export const PutawayRules = () => (
  <div className="h-full flex flex-col min-h-0">
    <Toolbar
      left={
        <div className="flex items-center gap-2">
          <ArrowRightLeft size={20} className="text-primary" />
          <h2 className="text-h3 font-bold">Putaway rules</h2>
        </div>
      }
      right={
        <Link
          to="/settings?section=putaway"
          className="inline-flex items-center gap-1.5 text-body-sm text-ink-muted hover:text-primary"
        >
          <Settings size={14} />
          All settings
        </Link>
      }
    />
    <div className="flex-1 min-h-0 overflow-y-auto p-4">
      <PutawayRulesManager />
    </div>
  </div>
);
