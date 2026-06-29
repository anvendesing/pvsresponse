// Customer dashboard shell. Sidebar with overview/orders/wishlist/
// addresses, content rendered via <Outlet>.

import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "@/state/AuthContext";
import { isPlaceholderCustomerName } from "@/lib/customer";

export const AccountLayout = () => {
  const auth = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!auth.isAuthed) navigate("/login", { replace: true });
  }, [auth.isAuthed, navigate]);

  if (!auth.user) return null;

  return (
    <div style={{ background: "var(--neutral-light)", minHeight: "70vh", padding: "2rem 5%" }}>
      <div
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "260px 1fr",
          gap: "2rem",
        }}
      >
        <aside className="card-soft" style={{ alignSelf: "start" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              marginBottom: "1.25rem",
              paddingBottom: "1rem",
              borderBottom: "1px solid rgba(34,37,31,0.08)",
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: "var(--radius-full)",
                background: "var(--forest-green-soft)",
                color: "var(--forest-green)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
              }}
            >
              {auth.user.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 700 }}>
                {auth.customer && !isPlaceholderCustomerName(auth.customer.name, auth.customer.phone)
                  ? auth.customer.name
                  : auth.user?.name && !isPlaceholderCustomerName(auth.user.name, auth.user.phone)
                  ? auth.user.name
                  : "My account"}
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--neutral-gray)" }}>
                {auth.customer?.phone ?? auth.user?.phone}
              </div>
            </div>
          </div>

          <nav style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <DashLink to="/account">Overview</DashLink>
            <DashLink to="/account/orders">My Orders</DashLink>
            <DashLink to="/account/wishlist">Wishlist</DashLink>
            <DashLink to="/account/addresses">Addresses</DashLink>
          </nav>

          <button
            type="button"
            onClick={() => {
              auth.signOut();
              navigate("/");
            }}
            className="btn btn-outline btn-block"
            style={{ marginTop: "1.25rem" }}
          >
            Sign out
          </button>
          <Link
            to="/"
            style={{
              display: "block",
              textAlign: "center",
              fontSize: "0.85rem",
              color: "var(--neutral-gray)",
              marginTop: "0.75rem",
            }}
          >
            Back to store
          </Link>
        </aside>

        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
};

const DashLink = ({ to, children }: { to: string; children: React.ReactNode }) => (
  <NavLink
    to={to}
    end={to === "/account"}
    style={({ isActive }) => ({
      padding: "0.65rem 0.85rem",
      borderRadius: "var(--radius-sm)",
      background: isActive ? "var(--forest-green-soft)" : "transparent",
      color: isActive ? "var(--forest-green)" : "var(--neutral-dark)",
      fontWeight: isActive ? 700 : 500,
      fontSize: "0.92rem",
    })}
  >
    {children}
  </NavLink>
);
