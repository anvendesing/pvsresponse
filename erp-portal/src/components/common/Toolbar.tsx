import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface Props {
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}

export const Toolbar = ({ left, right, className }: Props) => {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-2.5 bg-surface border-b border-border",
        className
      )}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">{left}</div>
      <div className="flex items-center gap-2 shrink-0">{right}</div>
    </div>
  );
};
