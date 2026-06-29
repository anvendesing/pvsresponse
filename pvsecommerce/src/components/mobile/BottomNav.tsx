// Mobile bottom tab bar (app-style navigation).
// Rendered instead of the desktop Header+NavBar when isPhone is true.
// Uses env(safe-area-inset-bottom) so content never hides behind the
// iOS home indicator or Android gesture bar.

import { NavLink, useLocation } from "react-router-dom";
import { useCart } from "@/state/CartContext";
import { useAuth } from "@/state/AuthContext";

const HomeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const ShopIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
  </svg>
);

const CartIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);

const OrdersIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const ProfileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export const BottomNav = () => {
  const cart = useCart();
  const auth = useAuth();
  const location = useLocation();

  const tabs = [
    { to: "/", label: "Home", Icon: HomeIcon, exact: true },
    { to: "/category/grains-pulses-flours", label: "Shop", Icon: ShopIcon, exact: false },
    { to: "/cart", label: "Cart", Icon: CartIcon, exact: false },
    {
      to: auth.isAuthed ? "/account/orders" : "/login",
      label: "Orders",
      Icon: OrdersIcon,
      exact: false,
    },
    {
      to: auth.isAuthed ? "/account" : "/login",
      label: "Profile",
      Icon: ProfileIcon,
      exact: false,
    },
  ];

  return (
    <nav className="mobile-bottom-nav" aria-label="App navigation">
      {tabs.map(({ to, label, Icon, exact }) => {
        const isActive = exact
          ? location.pathname === to
          : location.pathname.startsWith(to) && to !== "/";
        const showBadge = label === "Cart" && cart.count > 0;

        return (
          <NavLink
            key={label}
            to={to}
            className={`mobile-bottom-nav__tab${isActive ? " active" : ""}`}
            aria-label={label}
          >
            <span className="mobile-bottom-nav__icon">
              <Icon />
              {showBadge && (
                <span className="mobile-bottom-nav__badge">{cart.count}</span>
              )}
            </span>
            <span className="mobile-bottom-nav__label">{label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
};
