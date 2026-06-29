import { Navigate } from "react-router-dom";
import { useConcerns } from "@/state/ConcernsContext";

/** /concerns → first active concern (by sort order), no index landing page. */
export const ConcernsIndexPage = () => {
  const { concerns, loading } = useConcerns();

  if (loading) {
    return (
      <div className="listing-page">
        <div className="listing-row" style={{ gridTemplateColumns: "1fr" }}>
          <div className="card-soft" style={{ textAlign: "center", padding: "2rem" }}>
            <p className="muted">Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  const first = concerns[0];
  if (!first) {
    return <Navigate to="/" replace />;
  }

  return <Navigate to={`/concern/${first.slug}`} replace />;
};
