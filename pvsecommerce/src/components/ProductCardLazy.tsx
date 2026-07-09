// Lazy-load variant of ProductCard — image src is deferred until the card
// scrolls into view. Used on infinite-scroll listing pages only.

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { CatalogProduct, CatalogVariant } from "@/lib/api";
import { resolveImageSet, resolveUploadUrl } from "@/lib/api";
import { inr, packagingFromName } from "@/lib/format";
import { lineBarcode } from "@/lib/scanCode";
import { stockCapFor } from "@/lib/cartStock";
import { useCart } from "@/state/CartContext";
import { useWishlist } from "@/state/WishlistContext";
import { useToast } from "@/state/ToastContext";
import { HeartIcon } from "@/assets/icons";
import { PackagingArt } from "./PackagingArt";
import { useInView } from "@/hooks/useInView";

interface Props {
  product: CatalogProduct;
  badge?: string;
}

const LazyProductImage = ({
  product,
  onError,
}: {
  product: CatalogProduct;
  onError: () => void;
}) => {
  const { ref, inView } = useInView("160px");
  const imgSet = resolveImageSet(product.imageUrl, product.imageUpdatedAt);
  const fallbackSrc = resolveUploadUrl(product.imageUrl, product.imageUpdatedAt);

  return (
    <div ref={ref} className="product-card-lazy-image">
      {!inView ? (
        <div className="product-card-lazy-placeholder" aria-hidden="true" />
      ) : imgSet ? (
        <picture>
          <source
            type="image/webp"
            srcSet={`${imgSet.thumb.webp} 300w, ${imgSet.medium.webp} 600w`}
            sizes="(max-width: 540px) 50vw, 33vw"
          />
          <img
            src={imgSet.medium.jpeg}
            srcSet={`${imgSet.thumb.jpeg} 300w, ${imgSet.medium.jpeg} 600w`}
            sizes="(max-width: 540px) 50vw, 33vw"
            alt={product.name}
            className="product-card-photo"
            decoding="async"
            onError={onError}
          />
        </picture>
      ) : (
        <img
          src={fallbackSrc}
          alt={product.name}
          className="product-card-photo"
          decoding="async"
          onError={onError}
        />
      )}
    </div>
  );
};

export const ProductCardLazy = ({ product, badge }: Props) => {
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

  const stock = variant ? variant.inStock : product.inStock;
  const maxQty = stockCapFor(product, variant);
  const price = variant ? variant.price : product.sellingPrice;
  const wishlistKey = variant?.id ?? product.id;
  const isWished = wishlist.has(wishlistKey);

  const onAdd = () => {
    cart.add(product, variant, qty);
    toast.show(`Added ${product.name}`, "success");
  };

  const inc = () => setQty((q) => Math.min(q + 1, maxQty));
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
          <LazyProductImage product={product} onError={() => setImgFailed(true)} />
        ) : (
          <PackagingArt kind={packagingFromName(product.name)} />
        )}
        <span className={`product-card-stockbadge ${!stock ? "low" : ""}`}>
          {stock ? "In Stock" : "Sold out"}
        </span>
        <button
          type="button"
          className={`product-card-wishlist ${isWished ? "active" : ""}`}
          aria-label={isWished ? "Remove from wishlist" : "Add to wishlist"}
          onClick={(e) => {
            e.stopPropagation();
            wishlist.toggle(wishlistKey);
          }}
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
              title={
                lineBarcode({ barcode: v.barcode, productBarcode: product.barcode }) ??
                undefined
              }
            >
              {v.size ??
                lineBarcode({ barcode: v.barcode, productBarcode: product.barcode }) ??
                ""}
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
            <button type="button" aria-label="Increase" onClick={inc}>
              +
            </button>
          </span>
          {stock ? (
            <button
              type="button"
              className="add-to-cart-btn"
              onClick={onAdd}
            >
              Add to Cart
            </button>
          ) : (
            <Link
              to={`/enquiry?product=${encodeURIComponent(product.name)}`}
              className="add-to-cart-btn product-card-enquire"
              onClick={(e) => e.stopPropagation()}
            >
              Enquire
            </Link>
          )}
        </div>
      </div>
    </article>
  );
};
