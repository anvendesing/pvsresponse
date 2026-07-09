import { CheckIcon } from "@/assets/icons";

export const LISTING_CHUNK_SIZE = 9;

export const productInStock = (p: {
  inStock: boolean;
  variants: { inStock: boolean }[];
}): boolean => {
  if (p.variants.length > 0) return p.variants.some((v) => v.inStock);
  return p.inStock;
};

export const CheckboxRow = ({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) => (
  <button
    type="button"
    className={`filter-checkbox-row ${checked ? "checked" : ""}`}
    onClick={onToggle}
    style={{ width: "100%", textAlign: "left", background: "transparent" }}
  >
    <span className="check">{checked && <CheckIcon />}</span>
    <span>{label}</span>
  </button>
);
