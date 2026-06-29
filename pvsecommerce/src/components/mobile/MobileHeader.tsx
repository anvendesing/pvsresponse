// Compact top-bar for mobile (replaces the full desktop header).
// Shows: logo | search | cart icon.
// Category navigation is handled by CategoryChipStrip below this bar.

import { Link, useNavigate } from "react-router-dom";
import { useState, type FormEvent } from "react";
import { CartIcon, SearchIcon } from "@/assets/icons";
import { useCart } from "@/state/CartContext";

export const MobileHeader = () => {
  const cart = useCart();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `/?q=${encodeURIComponent(q)}` : "/");
    setSearchOpen(false);
  };

  return (
    <header className="mobile-header">
      <Link to="/" className="mobile-header__brand" aria-label="Prakruthivanam home">
        <img
          src="/brand/logo.png"
          alt="Prakruthivanam"
          className="mobile-header__logo"
          loading="eager"
          decoding="async"
        />
      </Link>

      {searchOpen ? (
        <form className="mobile-header__search-form" onSubmit={submitSearch}>
          <input
            autoFocus
            type="text"
            className="mobile-header__search-input"
            placeholder="Search products…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search products"
          />
          <button
            type="button"
            className="mobile-header__icon-btn"
            onClick={() => { setSearchOpen(false); setQuery(""); }}
            aria-label="Close search"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </form>
      ) : (
        <div className="mobile-header__actions">
          <button
            type="button"
            className="mobile-header__icon-btn"
            aria-label="Search"
            onClick={() => setSearchOpen(true)}
          >
            <SearchIcon />
          </button>
          <Link to="/cart" className="mobile-header__icon-btn" aria-label="Cart">
            <CartIcon />
            {cart.count > 0 && (
              <span className="mobile-header__badge">{cart.count}</span>
            )}
          </Link>
        </div>
      )}
    </header>
  );
};
