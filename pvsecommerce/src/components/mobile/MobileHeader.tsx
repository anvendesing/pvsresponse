// Compact sticky header for mobile (<768px).
// Layout: ☰  Logo  [flex-spacer]  🔍  🛒
// Hamburger opens the nav drawer (passed as prop from Layout).
// Search icon opens a full-screen search overlay with recent-searches.

import { Link, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef, type FormEvent } from "react";
import { CartIcon, SearchIcon } from "@/assets/icons";
import { useCart } from "@/state/CartContext";

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
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const clearRecents = () => {
    localStorage.removeItem(RECENT_KEY);
    setRecents([]);
  };

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
                placeholder="Search products…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search products"
                autoComplete="off"
              />
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
            {recents.length > 0 && (
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

            {query.trim().length > 0 && (
              <section className="search-overlay__section">
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

            {recents.length === 0 && query.trim().length === 0 && (
              <p className="search-overlay__hint">
                Type to search products, categories, or concerns.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
};
