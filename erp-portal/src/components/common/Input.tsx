import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  helper?: string;
  error?: string;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  size?: "sm" | "md" | "lg";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, helper, error, iconLeft, iconRight, className, size = "md", ...rest },
  ref
) {
  const heightCls = size === "sm" ? "h-8" : size === "lg" ? "h-12" : "h-10";
  return (
    <label className="flex flex-col gap-1.5 min-w-0">
      {label && (
        <span className="text-caption font-medium text-ink">{label}</span>
      )}
      <span
        className={cn(
          "flex items-center bg-white border rounded-md transition-colors min-w-0",
          heightCls,
          error
            ? "border-danger focus-within:border-danger focus-within:ring-2 focus-within:ring-danger/20"
            : "border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15"
        )}
      >
        {iconLeft && (
          <span className="pl-3 text-ink-muted shrink-0 flex items-center">
            {iconLeft}
          </span>
        )}
        <input
          ref={ref}
          className={cn(
            "flex-1 bg-transparent outline-none px-3 text-body text-ink placeholder:text-ink-muted/70 min-w-0",
            className
          )}
          {...rest}
        />
        {iconRight && (
          <span className="pr-3 text-ink-muted shrink-0 flex items-center">
            {iconRight}
          </span>
        )}
      </span>
      {error && error.trim() ? (
        <span className="text-caption text-danger">{error}</span>
      ) : helper ? (
        <span className="text-caption text-ink-muted">{helper}</span>
      ) : null}
    </label>
  );
});
