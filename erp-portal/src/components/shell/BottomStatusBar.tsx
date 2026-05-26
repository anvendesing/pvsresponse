import { useEffect, useState } from "react";
import {
  CircleCheck,
  CloudUpload,
  Database,
  GitBranch,
  ScanLine,
  Server,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/cn";

export const BottomStatusBar = () => {
  const [online, setOnline] = useState(true);
  const [latency, setLatency] = useState(42);
  const [queue, setQueue] = useState(3);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      setLatency(20 + Math.floor(Math.random() * 60));
      setSyncing((s) => !s);
      if (Math.random() > 0.7) setQueue((q) => Math.max(0, q + (Math.random() > 0.5 ? -1 : 1)));
    }, 3000);
    const tt = setInterval(() => setOnline((o) => (Math.random() > 0.97 ? !o : o)), 8000);
    return () => {
      clearInterval(t);
      clearInterval(tt);
    };
  }, []);

  return (
    <footer className="h-7 bg-primary text-white flex items-center px-3 gap-4 text-[11px] font-medium shrink-0">
      <div className="flex items-center gap-1.5">
        {online ? (
          <CloudUpload size={12} className={cn(syncing && "animate-pulse")} />
        ) : (
          <WifiOff size={12} className="text-warning" />
        )}
        <span>{online ? (syncing ? "Syncing…" : "Synced") : "Offline · Queue active"}</span>
      </div>
      <span className="opacity-30">|</span>
      <div className="flex items-center gap-1.5" title="Local queue">
        <Database size={12} />
        <span>Queue: {queue}</span>
      </div>
      <span className="opacity-30">|</span>
      <div className="flex items-center gap-1.5">
        <Server size={12} />
        <span>API {latency}ms</span>
        <span
          className={cn(
            "ml-1 h-1.5 w-1.5 rounded-full",
            latency < 80 ? "bg-success" : latency < 200 ? "bg-warning" : "bg-danger"
          )}
        />
      </div>
      <span className="opacity-30">|</span>
      <div className="flex items-center gap-1.5">
        <GitBranch size={12} />
        <span>WH-MAIN · Pune</span>
      </div>
      <div className="ml-auto flex items-center gap-4">
        <div className="flex items-center gap-1.5" title="Scanner status">
          <ScanLine size={12} />
          <span>Scanner ready</span>
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
        </div>
        <div className="flex items-center gap-1.5">
          <CircleCheck size={12} />
          <span>v1.0.0</span>
        </div>
      </div>
    </footer>
  );
};
