export const fileKeys = {
  directory: (path: string) => ["files", "directory", path] as const,
  content: (path: string) => ["files", "content", path] as const,
};
