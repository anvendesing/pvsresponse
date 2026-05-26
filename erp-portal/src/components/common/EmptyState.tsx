import { AlertTriangle, Loader2, PackageOpen } from "lucide-react";
import { Button } from "./Button";

interface Props {
  loading?: boolean;
  error?: Error | null;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRetry?: () => void;
}

export const EmptyState = ({
  loading,
  error,
  empty,
  emptyTitle = "No data yet",
  emptyDescription = "Add your first record using the actions above.",
  onRetry,
}: Props) => {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-ink-muted">
        <Loader2 size={28} className="animate-spin text-primary" />
        <div className="text-body font-semibold">Loading from API…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <AlertTriangle size={28} className="text-danger" />
        <div className="text-h3 font-semibold text-ink">Could not load data</div>
        <div className="text-body text-ink-muted max-w-md text-center">
          {error.message || "API request failed."}
        </div>
        <div className="text-caption text-ink-muted">
          Check the backend is running on the URL set in <code>VITE_API_URL</code>.
        </div>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    );
  }
  if (empty) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-ink-muted">
        <PackageOpen size={32} />
        <div className="text-h3 font-semibold text-ink">{emptyTitle}</div>
        <div className="text-body max-w-md text-center">{emptyDescription}</div>
      </div>
    );
  }
  return null;
};
