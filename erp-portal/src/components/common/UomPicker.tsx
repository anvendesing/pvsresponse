// UomPicker - dropdown that shows canonical UoMs grouped by category.
//
// Two operating modes:
//
//   1. Free - any UoM is selectable. Used when picking the primary
//      UoM of a new product (no existing constraint).
//
//   2. Restricted (categoryCode prop) - only UoMs in the given
//      category appear. Used in BOM rows so a kg-based recipe can
//      choose between kg / g / mg but not accidentally pick litres.
//
// Falls back to a plain text display when the master is still loading
// or fails to load, so the UI never blocks if /uoms is unreachable.
import { useUoms } from "@/hooks/useUoms";
import { cn } from "@/lib/cn";

interface Props {
  value: string;
  onChange: (code: string) => void;
  // When set, restrict the dropdown to UoMs in this category code.
  categoryCode?: string;
  // When set, restrict to the category of this UoM code (handy when
  // you have a parent product's uom but not its category code).
  categoryOfCode?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  // Show full name in label e.g. "kg - Kilogram" instead of just "kg".
  showName?: boolean;
  // When provided, an extra "" option is rendered at the top with this
  // label - lets the caller represent "inherit / not set" cleanly.
  // Picking the empty option fires `onChange("")`.
  placeholder?: string;
}

export const UomPicker = ({
  value,
  onChange,
  categoryCode,
  categoryOfCode,
  size = "md",
  disabled,
  className,
  showName = false,
  placeholder,
}: Props) => {
  const { categories, byCode, loading } = useUoms();

  // Resolve the active category constraint:
  //   explicit categoryCode wins, otherwise derive from categoryOfCode.
  const activeCategory =
    categoryCode ?? (categoryOfCode ? byCode(categoryOfCode)?.category?.code : undefined);

  // Filter the categories shown.
  const visibleCategories = activeCategory
    ? categories.filter((c) => c.code === activeCategory)
    : categories;

  // Until the master loads, render a plain input so we don't block
  // the UI - the value is still visible and typed-on edit works.
  if (loading) {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className={cn(
          "bg-white border border-border rounded-md px-2 outline-none focus:border-primary disabled:bg-canvas",
          size === "sm" ? "h-8 text-body-sm" : "h-10 text-body",
          className
        )}
      />
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={cn(
        "bg-white border border-border rounded-md px-2 outline-none focus:border-primary disabled:bg-canvas disabled:text-ink-muted",
        size === "sm" ? "h-8 text-body-sm" : "h-10 text-body",
        className
      )}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {/* If the current value isn't in the visible set, surface it as
          an extra "(legacy)" option so we don't silently change the
          stored value when the user edits unrelated fields. */}
      {value && !visibleCategories.some((c) => c.uoms.some((u) => u.code === value)) && (
        <option value={value}>{value} (legacy)</option>
      )}
      {visibleCategories.map((cat) => (
        <optgroup key={cat.code} label={cat.name}>
          {cat.uoms.map((u) => (
            <option key={u.code} value={u.code}>
              {showName ? `${u.code} - ${u.name}` : u.code}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
};
