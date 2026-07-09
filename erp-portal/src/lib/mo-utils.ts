import type { ProductionOrder } from "@/data/types";

export const isMoClosed = (s: ProductionOrder["status"]): boolean =>
  s === "completed" || (s as string) === "cancelled";

export const moStatusTone = (s: ProductionOrder["status"]) => {
  switch (s) {
    case "completed":
      return "success" as const;
    case "in-progress":
      return "primary" as const;
    case "qc":
      return "info" as const;
    case "delayed":
      return "danger" as const;
    case "planned":
      return "neutral" as const;
    case "cancelled":
      return "neutral" as const;
  }
};
