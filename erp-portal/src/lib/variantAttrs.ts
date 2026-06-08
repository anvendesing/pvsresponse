/** Human-readable variant descriptor — matches pick-list PDF layout. */
export type VariantLike =
  | { size?: string | null; color?: string | null; grade?: string | null }
  | null
  | undefined;

export const variantAttrs = (v: VariantLike): string =>
  [v?.size, v?.color, v?.grade].filter(Boolean).join(" / ");

/** SKU with optional " · size / color / grade" suffix. */
export const variantSkuLine = (
  sku: string,
  variant: VariantLike
): string => {
  const attrs = variantAttrs(variant);
  return attrs ? `${sku} · ${attrs}` : sku;
};
