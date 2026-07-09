// Full product detail page: artwork, variant selector, ingredients,
// description, add-to-cart, and related products from same category.

import { useState, useEffect } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import type { ProductDetail, CatalogVariant } from "@/lib/api";
import { api, resolveImageSet, resolveUploadUrl } from "@/lib/api";
import { track } from "@/lib/activity";
import { inr, packagingFromName } from "@/lib/format";
import { lineBarcode } from "@/lib/scanCode";
import { useCart } from "@/state/CartContext";
import { useWishlist } from "@/state/WishlistContext";
import { useToast } from "@/state/ToastContext";
import { useCatalog } from "@/state/CatalogContext";
import { usePlatform } from "@/state/PlatformContext";
import { STOCK_CAP } from "@/lib/cartStock";
import { PackagingArt } from "@/components/PackagingArt";
import { HeartIcon } from "@/assets/icons";

export const ProductDetailPage = () => {
  const { id = "" } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const cart = useCart();
  const wishlist = useWishlist();
  const toast = useToast();
  const { products: allProducts } = useCatalog();
  const { isPhone } = usePlatform();

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [variantId, setVariantId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [imgFailed, setImgFailed] = useState(false);
  const [tab, setTab] = useState<"description" | "ingredients">("description");

  useEffect(() => {
    setLoading(true);
    setError(false);
    api
      .product(id)
      .then((p) => {
        setProduct(p);
        const fromUrl = searchParams.get("variant");
        const pick =
          fromUrl && p.variants.some((v) => v.id === fromUrl)
            ? fromUrl
            : p.variants.length > 0
              ? p.variants[0].id
              : null;
        setVariantId(pick);
        setQty(1);
        track("product_view", { productId: id });
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id, searchParams]);

  if (loading)
    return (
      <div className="pdp-loading">
        <span className="pdp-spinner" />
        Loading product…
      </div>
    );

  if (error || !product)
    return (
      <div className="pdp-error">
        <p>Product not found.</p>
        <button className="btn-primary" onClick={() => navigate(-1)}>
          Go back
        </button>
      </div>
    );

  const variant: CatalogVariant | null =
    product.variants.find((v) => v.id === variantId) ??
    product.variants[0] ??
    null;

  const stock = variant ? variant.inStock : product.inStock;
  const price = variant ? variant.price : product.sellingPrice;
  const wishlistKey = variant?.id ?? product.id;
  const isWished = wishlist.has(wishlistKey);
  const packagingKind = packagingFromName(product.name);
  const scanCode = lineBarcode({
    barcode: variant?.barcode,
    productBarcode: product.barcode,
  });

  const onAdd = () => {
    cart.add(product, variant, qty);
    toast.show(`Added ${product.name} to cart`, "success");
  };

  const categorySlug = product.categorySlug ?? "";
  const categoryLabel = product.categoryName ?? product.category;

  const related = allProducts
    .filter((p) => p.categorySlug === categorySlug && p.id !== product.id)
    .slice(0, 4);

  const descriptionText = product.description?.trim() ?? "";
  const ingredientsText = product.ingredients?.trim() ?? "";
  const hasDescription = descriptionText.length > 0;
  const hasIngredients = ingredientsText.length > 0;
  type TabKey = "description" | "ingredients";
  const tabs: [TabKey, string][] = [];
  if (hasDescription) tabs.push(["description", "Description"]);
  if (hasIngredients) tabs.push(["ingredients", "Ingredients"]);
  const activeTab: TabKey = tabs.some(([k]) => k === tab) ? tab : (tabs[0]?.[0] ?? "description");

  return (
    <main className="pdp-page">
      {/* Breadcrumb */}
      <nav className="pdp-breadcrumb" aria-label="breadcrumb">
        <Link to="/">Home</Link>
        <span className="pdp-crumb-sep">›</span>
        <Link to={`/category/${categorySlug}`}>
          {categoryLabel}
        </Link>
        <span className="pdp-crumb-sep">›</span>
        <span>{product.name}</span>
      </nav>

      {/* Main 2-column layout */}
      <div className="pdp-grid">
        {/* Left — artwork */}
        <div className="pdp-artwork-col">
          <div className="pdp-art-frame">
            {(() => {
              if (!product.imageUrl || imgFailed) return <PackagingArt kind={packagingKind} />;
              const imgSet = resolveImageSet(product.imageUrl, product.imageUpdatedAt);
              if (imgSet) {
                return (
                  <picture>
                    <source
                      type="image/webp"
                      srcSet={`${imgSet.medium.webp} 600w, ${imgSet.large.webp} 1200w`}
                      sizes="(max-width: 768px) 100vw, 50vw"
                    />
                    <img
                      src={imgSet.large.jpeg}
                      srcSet={`${imgSet.medium.jpeg} 600w, ${imgSet.large.jpeg} 1200w`}
                      sizes="(max-width: 768px) 100vw, 50vw"
                      alt={product.name}
                      className="pdp-product-photo"
                      fetchPriority="high"
                      decoding="async"
                      onError={() => setImgFailed(true)}
                    />
                  </picture>
                );
              }
              return (
                <img
                  src={resolveUploadUrl(product.imageUrl, product.imageUpdatedAt)}
                  alt={product.name}
                  className="pdp-product-photo"
                  fetchPriority="high"
                  decoding="async"
                  onError={() => setImgFailed(true)}
                />
              );
            })()}
          </div>
          {product.tags.length > 0 && (
            <div className="pdp-tags">
              {product.tags.map((t) => (
                <span key={t} className="pdp-tag">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right — info */}
        <div className="pdp-info-col">
          <p className="pdp-category">{product.category}</p>
          <h1 className="pdp-title">{product.name}</h1>

          {/* Wishlist + barcode */}
          <div className="pdp-meta-row">
            {scanCode && <span className="pdp-sku">{scanCode}</span>}
            <button
              type="button"
              className={`pdp-wishlist-btn ${isWished ? "active" : ""}`}
              aria-label={isWished ? "Remove from wishlist" : "Add to wishlist"}
              onClick={() => wishlist.toggle(wishlistKey)}
            >
              <HeartIcon filled={isWished} />
              {isWished ? "Saved" : "Save"}
            </button>
          </div>

          {/* Price */}
          <div className="pdp-price-row">
            <span className="pdp-price">{inr(price)}</span>
            {variant?.uom && (
              <span className="pdp-uom">/ {variant.uom}</span>
            )}
            {!variant?.uom && product.uom && (
              <span className="pdp-uom">/ {product.uom}</span>
            )}
          </div>

          {/* Variant chips */}
          {product.variants.length > 0 && (
            <div className="pdp-variants">
              <p className="pdp-variants-label">Choose size</p>
              <div className="pdp-variant-chips">
                {product.variants.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={`pdp-chip ${v.id === variantId ? "active" : ""} ${
                      !v.inStock ? "disabled" : ""
                    }`}
                    disabled={!v.inStock}
                    onClick={() => {
                      setVariantId(v.id);
                      setQty(1);
                    }}
                  >
                    {v.size ?? lineBarcode({ barcode: v.barcode, productBarcode: product.barcode }) ?? ""}
                    {!v.inStock && (
                      <span className="pdp-chip-sold"> · Sold out</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Stock badge */}
          <div className="pdp-stock">
            {!stock ? (
              <>
                <span className="pdp-stock-badge out">Out of stock</span>
                <Link
                  to={`/enquiry?product=${encodeURIComponent(product.name)}`}
                  className="btn btn-outline pdp-enquire-btn"
                >
                  Enquire about availability
                </Link>
              </>
            ) : (
              <span className="pdp-stock-badge in">In stock</span>
            )}
          </div>

          {/* Qty + Add to cart */}
          <div className="pdp-cart-row">
            <span className="qty-pill">
              <button
                type="button"
                aria-label="Decrease"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
              >
                −
              </button>
              <span className="qty-val">{qty}</span>
              <button
                type="button"
                aria-label="Increase"
                onClick={() => setQty((q) => Math.min(q + 1, STOCK_CAP))}
                disabled={qty >= STOCK_CAP}
              >
                +
              </button>
            </span>
            <button
              type="button"
              className="btn-primary pdp-add-btn"
              disabled={!stock}
              onClick={onAdd}
            >
              {stock ? "Add to Cart" : "Sold Out"}
            </button>
          </div>

          {/* Info pills */}
          <div className="pdp-pills">
            <span className="pdp-pill">🌿 100% Natural</span>
            <span className="pdp-pill">✓ Farm-direct</span>
            <span className="pdp-pill">⚡ Express Delivery</span>
          </div>
        </div>
      </div>

      {tabs.length > 0 && (
      <section className="pdp-tabs-section">
        <div className="pdp-tabs">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`pdp-tab ${activeTab === key ? "active" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="pdp-tab-panel">
          {activeTab === "description" && hasDescription && (
            <div className="pdp-description">
              <p>{descriptionText}</p>
            </div>
          )}

          {activeTab === "ingredients" && hasIngredients && (
            <div className="pdp-ingredients">
              <p className="pdp-ingredients-intro">{ingredientsText}</p>
              {(() => {
                const cards = ingredientsText
                  .split(/\n/)
                  .map((item) => item.replace(/^[-•*]\s*/, "").trim())
                  .filter((item) => item.length > 0);
                if (cards.length <= 1) return null;
                return (
                  <div className="pdp-ingredients-grid">
                    {cards.map((item, i) => (
                      <div key={i} className="pdp-ingredient-card">
                        <span className="pdp-ingredient-icon">🌱</span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </section>
      )}

      {/* Related products */}
      {related.length > 0 && (
        <section className="pdp-related">
          <h2 className="section-title">More from {categoryLabel}</h2>
          <div className="pdp-related-grid">
            {related.map((rel) => {
              const relVariant = rel.variants.find((v) => v.inStock) ?? rel.variants[0] ?? null;
              const relPrice = relVariant ? relVariant.price : rel.sellingPrice;
              const relImg = resolveUploadUrl(rel.imageUrl, rel.imageUpdatedAt);
              return (
                <Link
                  key={rel.id}
                  to={`/product/${rel.id}`}
                  className="pdp-related-card"
                >
                  <div className="pdp-related-art">
                    {relImg ? (
                      <img src={relImg} alt={rel.name} className="pdp-related-photo" loading="lazy" decoding="async" />
                    ) : (
                      <PackagingArt kind={packagingFromName(rel.name)} />
                    )}
                  </div>
                  <p className="pdp-related-name">{rel.name}</p>
                  <p className="pdp-related-price">{inr(relPrice)}</p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Sticky bottom CTA on phone */}
      {isPhone && stock && (
        <div className="sticky-bottom-cta">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "0.75rem", color: "var(--neutral-gray)", marginBottom: "0.1rem" }}>{product.name}</div>
            <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--forest-green)" }}>{inr(price)}</div>
          </div>
          <button
            type="button"
            className="btn btn-green"
            style={{ flex: "none", padding: "0.75rem 1.5rem" }}
            onClick={onAdd}
          >
            Add to Cart
          </button>
        </div>
      )}
    </main>
  );
};
