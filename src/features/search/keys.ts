import type { SearchOptions } from "./type";

export const searchKeys = {
  all: ["search"] as const,
  results: (root: string, query: string, options: SearchOptions) => ["search", "results", root, query, options] as const,
};
