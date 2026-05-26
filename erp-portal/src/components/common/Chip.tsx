import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "primary";

interface ChipProps {
  tone?: Tone;
  size?: "sm" | "md";
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

const toneClasses: Record<Tone, string> = {
  neutral: "bg-canvas text-ink",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-[#8a6300]",
  danger: "bg-danger-soft text-danger",
  info: "bg-[#E1F4FB] text-secondary",
  primary: "bg-primary-50 text-primary",
};

export const Chip = ({ tone = "neutral", size = "md", icon, children, className }: ChipProps) => {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
        size === "sm" ? "h-6 px-2 text-[11px]" : "h-7 px-3 text-caption",
        toneClasses[tone],
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
};

export const StatusDot = ({ tone = "neutral", className }: { tone?: Tone; className?: string }) => {
  const toneBg: Record<Tone, string> = {
    neutral: "bg-ink-muted",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    info: "bg-secondary",
    primary: "bg-primary",
  };
  return <span className={cn("inline-block h-2 w-2 rounded-full", toneBg[tone], className)} />;
};
