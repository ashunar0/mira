export const gitKeys = {
  all: ["git"] as const,
  status: (root: string) => ["git", "status", root] as const,
  headText: (path: string) => ["git", "headText", path] as const,
};
