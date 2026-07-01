// Compact sticky header for mobile (<768px).
// Layout: ☰  Logo  [flex-spacer]  🔍  🛒
// Hamburger opens the nav drawer (passed as prop from Layout).
// Search icon opens a full-screen search overlay with recent-searches
// and live product suggestions when ≥3 chars are typed.

import { Link, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef, useMemo, type FormEvent } from "react";
import { CartIcon, SearchIcon } from "@/assets/icons";
import { useCart } from "@/state/CartContext";
import { useCatalog } from "@/state/CatalogContext";
import type { CatalogProduct } from "@/lib/api";

const RECENT_KEY = "pvs_recent_searches";
const MAX_RECENT = 6;

function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function saveRecent(q: string) {
  const list = [q, ...getRecent().filter((r) => r !== q)].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

interface Props {
  onOpenDrawer: () => void;
}

export const MobileHeader = ({ onOpenDrawer }: Props) => {
  const cart = useCart();
  const navigate = useNavigate();
  const { products } = useCatalog();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Live suggestions when ≥3 chars typed
  const suggestions = useMemo<CatalogProduct[]>(() => {
    const q = query.trim();
    if (q.length < 3) return [];
    const needle = q.toLowerCase();
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          (p.searchAliases ?? []).some((a) => a.toLowerCase().includes(needle))
      )
      .slice(0, 10);
  }, [query, products]);

  // Load recents when overlay opens
  useEffect(() => {
    if (searchOpen) {
      setRecents(getRecent());
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [searchOpen]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSearch();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    saveRecent(q);
    navigate(`/?q=${encodeURIComponent(q)}`);
    closeSearch();
  };

  const pickRecent = (q: string) => {
    saveRecent(q);
    navigate(`/?q=${encodeURIComponent(q)}`);
    closeSearch();
  };

  const pickProduct = (p: CatalogProduct) => {
    saveRecent(p.name);
    navigate(`/product/${p.id}`);
    closeSearch();
  };

  const clearRecents = () => {
    localStorage.removeItem(RECENT_KEY);
    setRecents([]);
  };

  // Highlight matching portion
  const highlight = (text: string, needle: string) => {
    const idx = text.toLowerCase().indexOf(needle.toLowerCase());
    if (idx === -1 || !needle) return <>{text}</>;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="search-highlight">{text.slice(idx, idx + needle.length)}</mark>
        {text.slice(idx + needle.length)}
      </>
    );
  };

  const showSuggestions = query.trim().length >= 3 && suggestions.length > 0;
  const showRecents = query.trim().length === 0 && recents.length > 0;
  const showEmptyHint = query.trim().length === 0 && recents.length === 0;
  const showNoResults = query.trim().length >= 3 && suggestions.length === 0;

  return (
    <>
      <header className="mobile-header">
        {/* Hamburger */}
        <button
          type="button"
          className="mobile-header__icon-btn"
          aria-label="Open menu"
          onClick={onOpenDrawer}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        {/* Logo — centered */}
        <Link to="/" className="mobile-header__brand" aria-label="Prakruthivanam home">
          <img
            src="/brand/logo.png"
            alt="Prakruthivanam"
            className="mobile-header__logo"
            loading="eager"
            decoding="async"
          />
        </Link>

        {/* Right actions */}
        <div className="mobile-header__actions">
          <button
            type="button"
            className="mobile-header__icon-btn"
            aria-label="Search"
            onClick={() => setSearchOpen(true)}
          >
            <SearchIcon />
          </button>
          <Link to="/cart" className="mobile-header__icon-btn" aria-label={`Cart, ${cart.count} items`}>
            <CartIcon />
            {cart.count > 0 && (
              <span className="mobile-header__badge">{cart.count}</span>
            )}
          </Link>
        </div>
      </header>

      {/* Full-screen search overlay */}
      {searchOpen && (
        <div className="search-overlay" role="dialog" aria-modal="true" aria-label="Search">
          <div className="search-overlay__bar">
            <form className="search-overlay__form" onSubmit={submitSearch}>
              <SearchIcon />
              <input
                ref={inputRef}
                type="search"
                className="search-overlay__input"
                placeholder="Search products, herbs, remedies…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search products"
                autoComplete="off"
              />
              {query.length > 0 && (
                <button
                  type="button"
                  className="search-overlay__clear-input"
                  onClick={() => setQuery("")}
                  aria-label="Clear"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </form>
            <button
              type="button"
              className="search-overlay__close"
              onClick={closeSearch}
              aria-label="Close search"
            >
              Cancel
            </button>
          </div>

          <div className="search-overlay__body">
            {/* Live product suggestions */}
            {showSuggestions && (
              <section className="search-overlay__section">
                <div className="search-overlay__section-header">
                  <span>Products</span>
                  <span className="search-overlay__count">{suggestions.length} found</span>
                </div>
                {suggestions.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="search-overlay__product-item"
                    onClick={() => pickProduct(p)}
                  >
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt="" className="search-overlay__product-thumb" loading="lazy" />
                    ) : (
                      <div className="search-overlay__product-thumb search-overlay__product-thumb--placeholder" />
                    )}
                    <div className="search-overlay__product-info">
                      <span className="search-overlay__product-name">
                        {highlight(p.name, query.trim())}
                      </span>
                      <div className="search-overlay__product-meta">
                        {p.category && (
                          <span className="search-overlay__product-cat">{p.category}</span>
                        )}
                        {p.searchAliases && p.searchAliases.length > 0 && (
                          <span
                            className="search-overlay__product-aliases"
                            title={p.searchAliases.join(" · ")}
                          >
                            {p.searchAliases.slice(0, 2).join(" · ")}
                            {p.searchAliases.length > 2 && (
                              <span className="search-overlay__aliases-more">
                                {" "}+{p.searchAliases.length - 2}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="search-overlay__product-arrow">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                ))}
                {/* Full search fallback */}
                <button
                  type="button"
                  className="search-overlay__go-btn"
                  style={{ marginTop: "0.5rem" }}
                  onClick={() => {
                    saveRecent(query.trim());
                    navigate(`/?q=${encodeURIComponent(query.trim())}`);
                    closeSearch();
                  }}
                >
                  <SearchIcon />
                  See all results for "<strong>{query.trim()}</strong>"
                </button>
              </section>
            )}

            {/* No results */}
            {showNoResults && (
              <section className="search-overlay__section">
                <p className="search-overlay__hint">
                  No products found for "<strong>{query.trim()}</strong>". Try a different keyword.
                </p>
                <button
                  type="button"
                  className="search-overlay__go-btn"
                  onClick={() => {
                    saveRecent(query.trim());
                    navigate(`/?q=${encodeURIComponent(query.trim())}`);
                    closeSearch();
                  }}
                >
                  <SearchIcon />
                  Search for "<strong>{query.trim()}</strong>"
                </button>
              </section>
            )}

            {/* Query < 3 chars but something typed */}
            {!showSuggestions && !showNoResults && query.trim().length > 0 && (
              <p className="search-overlay__hint">Keep typing to see suggestions…</p>
            )}

            {/* Recent searches */}
            {showRecents && (
              <section className="search-overlay__section">
                <div className="search-overlay__section-header">
                  <span>Recent searches</span>
                  <button type="button" className="search-overlay__clear" onClick={clearRecents}>
                    Clear
                  </button>
                </div>
                {recents.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className="search-overlay__recent-item"
                    onClick={() => pickRecent(r)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    {r}
                  </button>
                ))}
              </section>
            )}

            {showEmptyHint && (
              <p className="search-overlay__hint">
                Type 3 or more characters to see product suggestions.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
};
