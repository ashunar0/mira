export const fileKeys = {
  directory: (path: string) => ["files", "directory", path] as const,
  workspaceFiles: (root: string) => ["files", "workspace", root] as const,
  content: (path: string) => ["files", "content", path] as const,
};
