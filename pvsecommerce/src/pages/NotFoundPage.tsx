import { Link } from "react-router-dom";

export const NotFoundPage = () => (
  <div
    style={{
      padding: "4rem 1rem",
      textAlign: "center",
      background: "var(--neutral-light)",
      minHeight: "60vh",
    }}
  >
    <h1
      className="serif-title"
      style={{ fontSize: "2rem", color: "var(--forest-green-dark)" }}
    >
      Page not found
    </h1>
    <p className="muted" style={{ margin: "0.5rem 0 1.25rem" }}>
      The link you followed doesn't lead anywhere we farm.
    </p>
    <Link to="/" className="btn btn-green">
      Back to home
    </Link>
  </div>
);
