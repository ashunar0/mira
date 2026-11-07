export const fileKeys = {
  all: ["files"] as const,
  directories: ["files", "directory"] as const,
  workspace: ["files", "workspace"] as const,
  directory: (path: string) => ["files", "directory", path] as const,
  workspaceFiles: (root: string) => ["files", "workspace", root] as const,
  content: (path: string) => ["files", "content", path] as const,
};
