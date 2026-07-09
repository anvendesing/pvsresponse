import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface Props {
  title: string;
  children: ReactNode;
}

export const PolicyPageLayout = ({ title, children }: Props) => (
  <div className="policy-page">
    <div className="policy-page__inner card-soft">
      <nav className="policy-page__crumb" aria-label="breadcrumb">
        <Link to="/">Home</Link>
        <span aria-hidden="true"> › </span>
        <span>{title}</span>
      </nav>
      <h1 className="serif-title policy-page__title">{title}</h1>
      <div className="policy-page__body">{children}</div>
      <p className="policy-page__help muted">
        Questions?{" "}
        <Link to="/contact" className="text-link">
          Contact us
        </Link>{" "}
        or call{" "}
        <a href="tel:+919492903765" className="text-link">
          +91 94929 03765
        </a>
        .
      </p>
    </div>
  </div>
);
