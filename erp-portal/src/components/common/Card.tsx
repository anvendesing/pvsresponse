import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  bodyClassName?: string;
  noPadding?: boolean;
  accent?: "primary" | "success" | "warning" | "danger" | "none";
}

const accentMap: Record<NonNullable<CardProps["accent"]>, string> = {
  primary: "border-l-4 border-l-primary",
  success: "border-l-4 border-l-success",
  warning: "border-l-4 border-l-warning",
  danger: "border-l-4 border-l-danger",
  none: "",
};

export const Card = ({
  title,
  subtitle,
  actions,
  className,
  bodyClassName,
  noPadding,
  accent = "none",
  children,
  ...rest
}: CardProps) => {
  return (
    <div
      className={cn(
        "bg-surface border border-border rounded-lg shadow-e1",
        accentMap[accent],
        className
      )}
      {...rest}
    >
      {(title || actions) && (
        // flex-wrap lets the actions row drop below the title when the
        // card column is narrower than the combined natural width of
        // title + actions (avoids the "title squeezed character by
        // character" wrap that happened in narrow tab layouts).
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 border-b border-border">
          <div className="min-w-0 flex-1 basis-48">
            {title && (
              <div className="text-body font-semibold text-ink truncate">{title}</div>
            )}
            {subtitle && (
              <div className="text-caption text-ink-muted mt-0.5 truncate">{subtitle}</div>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>
          )}
        </div>
      )}
      <div className={cn(!noPadding && "p-4", bodyClassName)}>{children}</div>
    </div>
  );
};
