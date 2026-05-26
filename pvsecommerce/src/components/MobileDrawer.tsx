import { Link } from "react-router-dom";
import { CloseIcon } from "@/assets/icons";
import { CATEGORIES } from "@/data/categories";

interface Props {
  open: boolean;
  onClose: () => void;
}

export const MobileDrawer = ({ open, onClose }: Props) => {
  return (
    <>
      <div
        className={`drawer-backdrop ${open ? "open" : ""}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`mobile-drawer ${open ? "open" : ""}`}
        aria-hidden={!open}
        aria-label="Mobile navigation"
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1.5rem",
          }}
        >
          <img
            src="/brand/logo.png"
            alt="Prakruthivanam"
            style={{ height: 40, width: "auto", objectFit: "contain" }}
          />
          <button
            type="button"
            onClick={onClose}
            className="util-btn"
            aria-label="Close menu"
          >
            <CloseIcon />
          </button>
        </div>
        <Link className="nav-link" to="/" onClick={onClose}>
          All Products
        </Link>
        {CATEGORIES.map((c) => (
          <Link
            key={c.id}
            className="nav-link"
            to={`/category/${c.id}`}
            onClick={onClose}
          >
            {c.name}
          </Link>
        ))}
        <Link className="nav-link" to="/account" onClick={onClose}>
          My Account
        </Link>
        <Link className="nav-link" to="/account/orders" onClick={onClose}>
          My Orders
        </Link>
      </aside>
    </>
  );
};
