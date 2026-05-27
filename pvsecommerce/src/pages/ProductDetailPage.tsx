// Full product detail page: artwork, variant selector, ingredients,
// description, add-to-cart, and related products from same category.

import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import type { ProductDetail, CatalogVariant } from "@/lib/api";
import { api } from "@/lib/api";
import { inr, packagingFromName } from "@/lib/format";
import { useCart } from "@/state/CartContext";
import { useWishlist } from "@/state/WishlistContext";
import { useToast } from "@/state/ToastContext";
import { useCatalog } from "@/state/CatalogContext";
import { PackagingArt } from "@/components/PackagingArt";
import { HeartIcon } from "@/assets/icons";
import { bucketFor, getCategory } from "@/data/categories";

export const ProductDetailPage = () => {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const cart = useCart();
  const wishlist = useWishlist();
  const toast = useToast();
  const { products: allProducts } = useCatalog();

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [variantId, setVariantId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [imgFailed, setImgFailed] = useState(false);
  const [tab, setTab] = useState<"description" | "ingredients" | "how-to-use">(
    "description"
  );

  useEffect(() => {
    setLoading(true);
    setError(false);
    api
      .product(id)
      .then((p) => {
        setProduct(p);
        setVariantId(p.variants.length > 0 ? p.variants[0].id : null);
        setQty(1);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

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

  const stock = variant ? variant.stockOnHand : product.stockOnHand;
  const price = variant ? variant.price : product.sellingPrice;
  const wishlistKey = variant?.id ?? product.id;
  const isWished = wishlist.has(wishlistKey);
  const packagingKind = packagingFromName(product.name);

  const onAdd = () => {
    cart.add(product, variant, qty);
    toast.show(`Added ${product.name} to cart`, "success");
  };

  const categoryId = bucketFor(product.category, product.name);
  const categoryDef = getCategory(categoryId);

  const related = allProducts
    .filter(
      (p) =>
        bucketFor(p.category, p.name) === categoryId && p.id !== product.id
    )
    .slice(0, 4);

  const descriptionText =
    product.description ??
    `${product.name} is a premium natural product from the farms of Prakruthivanam. ` +
      `Made with care and sourced directly from organic farms, it preserves the ` +
      `goodness of nature for your everyday wellness.`;

  const ingredientsText =
    product.ingredients ??
    `100% natural ${product.name.toLowerCase()}. No artificial additives, ` +
      `preservatives, or colorants. Sourced from certified organic farms.`;

  return (
    <main className="pdp-page">
      {/* Breadcrumb */}
      <nav className="pdp-breadcrumb" aria-label="breadcrumb">
        <Link to="/">Home</Link>
        <span className="pdp-crumb-sep">›</span>
        <Link to={`/category/${categoryId}`}>
          {categoryDef?.name ?? product.category}
        </Link>
        <span className="pdp-crumb-sep">›</span>
        <span>{product.name}</span>
      </nav>

      {/* Main 2-column layout */}
      <div className="pdp-grid">
        {/* Left — artwork */}
        <div className="pdp-artwork-col">
          <div className="pdp-art-frame">
            {product.imageUrl && !imgFailed ? (
              <img
                src={product.imageUrl}
                alt={product.name}
                className="pdp-product-photo"
                loading="eager"
                onError={() => setImgFailed(true)}
              />
            ) : (
              <PackagingArt kind={packagingKind} />
            )}
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

          {/* Wishlist + sku */}
          <div className="pdp-meta-row">
            <span className="pdp-sku">SKU: {variant?.sku ?? product.sku}</span>
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
                      v.stockOnHand <= 0 ? "disabled" : ""
                    }`}
                    disabled={v.stockOnHand <= 0}
                    onClick={() => {
                      setVariantId(v.id);
                      setQty(1);
                    }}
                  >
                    {v.size ?? v.sku}
                    {v.stockOnHand <= 0 && (
                      <span className="pdp-chip-sold"> · Sold out</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Stock badge */}
          <div className="pdp-stock">
            {stock <= 0 ? (
              <span className="pdp-stock-badge out">Out of stock</span>
            ) : stock <= 5 ? (
              <span className="pdp-stock-badge low">
                Only {stock} left!
              </span>
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
                onClick={() => setQty((q) => Math.min(q + 1, stock || 1))}
                disabled={qty >= stock}
              >
                +
              </button>
            </span>
            <button
              type="button"
              className="btn-primary pdp-add-btn"
              disabled={stock <= 0}
              onClick={onAdd}
            >
              {stock > 0 ? "Add to Cart" : "Sold Out"}
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

      {/* Tabs: description / ingredients / how-to-use */}
      <section className="pdp-tabs-section">
        <div className="pdp-tabs">
          {(
            [
              ["description", "Description"],
              ["ingredients", "Ingredients"],
              ["how-to-use", "How to Use"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`pdp-tab ${tab === key ? "active" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="pdp-tab-panel">
          {tab === "description" && (
            <div className="pdp-description">
              <p>{descriptionText}</p>
              <ul className="pdp-benefits">
                <li>Rich in natural nutrients and antioxidants</li>
                <li>Free from chemical processing</li>
                <li>Ethically sourced from small-scale organic farms</li>
                <li>Suitable for everyday use</li>
              </ul>
            </div>
          )}

          {tab === "ingredients" && (
            <div className="pdp-ingredients">
              <p className="pdp-ingredients-intro">{ingredientsText}</p>
              <div className="pdp-ingredients-grid">
                {ingredientsText
                  .split(/[,\n]/)
                  .map((item) => item.trim())
                  .filter(Boolean)
                  .map((item, i) => (
                    <div key={i} className="pdp-ingredient-card">
                      <span className="pdp-ingredient-icon">🌱</span>
                      <span>{item}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {tab === "how-to-use" && (
            <div className="pdp-how-to-use">
              <ol className="pdp-steps">
                <li>Store in a cool, dry place away from direct sunlight.</li>
                <li>
                  Use as directed — incorporate into your daily cooking or
                  wellness routine.
                </li>
                <li>
                  Best consumed within 6 months of opening. Refrigerate after
                  opening if required.
                </li>
                <li>
                  Keep out of reach of children. Not a substitute for
                  professional medical advice.
                </li>
              </ol>
            </div>
          )}
        </div>
      </section>

      {/* Related products */}
      {related.length > 0 && (
        <section className="pdp-related">
          <h2 className="section-title">More from {categoryDef?.name ?? product.category}</h2>
          <div className="pdp-related-grid">
            {related.map((rel) => {
              const relVariant = rel.variants[0] ?? null;
              const relPrice = relVariant ? relVariant.price : rel.sellingPrice;
              return (
                <Link
                  key={rel.id}
                  to={`/product/${rel.id}`}
                  className="pdp-related-card"
                >
                  <div className="pdp-related-art">
                    <PackagingArt kind={packagingFromName(rel.name)} />
                  </div>
                  <p className="pdp-related-name">{rel.name}</p>
                  <p className="pdp-related-price">{inr(relPrice)}</p>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
};
