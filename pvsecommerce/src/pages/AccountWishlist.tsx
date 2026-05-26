// Wishlist tab. Cross-references the wishlist context (which holds
// variant-or-product ids) against the catalog so we can render real
// product cards.

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ProductCard } from "@/components/ProductCard";
import { useCatalog } from "@/state/CatalogContext";
import { useWishlist } from "@/state/WishlistContext";

export const AccountWishlist = () => {
  const { products, loading } = useCatalog();
  const wishlist = useWishlist();

  const wished = useMemo(
    () =>
      products.filter((p) => {
        if (wishlist.has(p.id)) return true;
        return p.variants.some((v) => wishlist.has(v.id));
      }),
    [products, wishlist]
  );

  return (
    <div className="card-soft">
      <h2 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>Wishlist</h2>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : wished.length === 0 ? (
        <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
          <p className="muted" style={{ marginBottom: "0.85rem" }}>
            Your wishlist is empty. Tap the heart on any product to save it here.
          </p>
          <Link to="/" className="btn btn-green">
            Browse the store
          </Link>
        </div>
      ) : (
        <div className="listing-products-grid">
          {wished.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
};
