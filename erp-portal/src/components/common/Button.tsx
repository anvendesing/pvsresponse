import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "gold" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-hover active:bg-primary-hover disabled:bg-border disabled:text-ink-muted",
  secondary:
    "bg-white text-primary border-2 border-primary hover:bg-canvas active:bg-primary-50 disabled:bg-canvas disabled:text-ink-muted disabled:border-border",
  ghost:
    "bg-transparent text-ink hover:bg-canvas active:bg-primary-50 disabled:text-ink-muted",
  gold: "bg-warning text-ink hover:brightness-95 active:brightness-90",
  danger: "bg-danger text-white hover:brightness-95",
  outline:
    "bg-white text-ink border border-border hover:border-primary hover:text-primary disabled:text-ink-muted",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-body-sm rounded-md gap-1.5",
  md: "h-10 px-4 text-body rounded-md gap-2",
  lg: "h-12 px-6 text-body rounded-md gap-2",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", size = "md", icon, iconRight, loading, className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center font-semibold transition-colors",
        "disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        icon
      )}
      {children}
      {iconRight}
    </button>
  );
});
