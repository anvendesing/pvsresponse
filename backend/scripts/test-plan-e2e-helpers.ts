/** Shared types + builder for E2E test plan rows. */
export type E2eRow = {
  area: string;
  item: string;
  tc: string;
  steps: string;
  expected: string;
  type: string;
  priority: "High" | "Medium" | "Low";
};

type E2eOpts = {
  area?: string;
  type?: string;
  priority?: E2eRow["priority"];
};

/** Shorthand to keep case definitions readable in large E2E modules. */
export const e2e = (
  item: string,
  tc: string,
  steps: string,
  expected: string,
  opts: E2eOpts = {}
): E2eRow => ({
  area: opts.area ?? "E2E",
  item,
  tc,
  steps,
  expected,
  type: opts.type ?? "Integration",
  priority: opts.priority ?? "High",
});
