// Product card used on Home, Category, and Concern listing grids.
// listings. Renders one row per backend product. Variants are
// surfaced as weight chips - clicking a chip selects that variant,
// the price updates, and "Add to cart" pushes the chosen variant
// into the cart.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CatalogProduct, CatalogVariant } from "@/lib/api";
import { inr, packagingFromName } from "@/lib/format";
import { lineBarcode } from "@/lib/scanCode";
import { useCart } from "@/state/CartContext";
import { useWishlist } from "@/state/WishlistContext";
import { useToast } from "@/state/ToastContext";
import { HeartIcon } from "@/assets/icons";
import { PackagingArt } from "./PackagingArt";

interface Props {
  product: CatalogProduct;
  badge?: string;
}

export const ProductCard = ({ product, badge }: Props) => {
  const navigate = useNavigate();
  const cart = useCart();
  const wishlist = useWishlist();
  const toast = useToast();

  const variants = product.variants.length > 0 ? product.variants : null;
  const [variantId, setVariantId] = useState<string | null>(
    variants ? variants[0].id : null
  );
  const [qty, setQty] = useState(1);

  const variant: CatalogVariant | null = variants
    ? variants.find((v) => v.id === variantId) ?? variants[0]
    : null;

  const [imgFailed, setImgFailed] = useState(false);

  const stock = variant ? variant.stockOnHand : product.stockOnHand;
  const price = variant ? variant.price : product.sellingPrice;
  const lowStock = stock <= 5;
  const wishlistKey = variant?.id ?? product.id;
  const isWished = wishlist.has(wishlistKey);

  const onAdd = () => {
    cart.add(product, variant, qty);
    toast.show(`Added ${product.name}`, "success");
  };

  const inc = () => setQty((q) => Math.min(q + 1, stock || 1));
  const dec = () => setQty((q) => Math.max(1, q - 1));

  const scanCode = lineBarcode({
    barcode: variant?.barcode,
    productBarcode: product.barcode,
  });

  return (
    <article
      className="product-card"
      onClick={() => navigate(`/product/${product.id}`)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && navigate(`/product/${product.id}`)}
    >
      <div className="product-card-art">
        {product.imageUrl && !imgFailed ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="product-card-photo"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <PackagingArt kind={packagingFromName(product.name)} />
        )}
        <span className={`product-card-stockbadge ${lowStock ? "low" : ""}`}>
          {stock > 0 ? (lowStock ? `${stock} left` : "In Stock") : "Sold out"}
        </span>
        <button
          type="button"
          className={`product-card-wishlist ${isWished ? "active" : ""}`}
          aria-label={isWished ? "Remove from wishlist" : "Add to wishlist"}
          onClick={(e) => { e.stopPropagation(); wishlist.toggle(wishlistKey); }}
        >
          <HeartIcon filled={isWished} />
        </button>
      </div>
      <div className="product-card-title" title={product.name}>
        {product.name}
      </div>
      <div className="product-card-meta">
        {badge ? (
          <span style={{ color: "var(--forest-green)", fontWeight: 700 }}>
            {badge}
          </span>
        ) : (
          scanCode ?? ""
        )}
      </div>

      {variants && variants.length > 0 && (
        <div
          className="weight-options"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {variants.map((v) => (
            <button
              type="button"
              key={v.id}
              className={`weight-chip ${v.id === variantId ? "active" : ""}`}
              onClick={() => {
                setVariantId(v.id);
                setQty(1);
              }}
              title={lineBarcode({ barcode: v.barcode, productBarcode: product.barcode }) ?? undefined}
            >
              {v.size ?? lineBarcode({ barcode: v.barcode, productBarcode: product.barcode }) ?? ""}
            </button>
          ))}
        </div>
      )}

      <div className="product-card-price-row">
        <span className="product-card-price">{inr(price)}</span>
        <span style={{ fontSize: "0.7rem", color: "var(--neutral-gray)" }}>
          {variant?.uom ?? product.uom ?? ""}
        </span>
      </div>

      <div
        className="product-card-foot"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span className="qty-pill">
            <button type="button" aria-label="Decrease" onClick={dec}>
              −
            </button>
            <span className="qty-val">{qty}</span>
            <button
              type="button"
              aria-label="Increase"
              onClick={inc}
              disabled={qty >= stock}
            >
              +
            </button>
          </span>
          <button
            type="button"
            className="add-to-cart-btn"
            disabled={stock <= 0}
            onClick={onAdd}
          >
            {stock > 0 ? "Add to Cart" : "Sold out"}
          </button>
        </div>
      </div>
    </article>
  );
};
