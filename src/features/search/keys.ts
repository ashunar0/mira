export const searchKeys = {
  all: ["search"] as const,
  results: (root: string, query: string) => ["search", "results", root, query] as const,
};
