export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function parentPath(path: string): string {
  return path.slice(0, path.lastIndexOf("/")) || "/";
}

/** root より下、path より上のディレクトリを root に近い順に返す */
export function ancestorsWithin(root: string, path: string): string[] {
  if (!path.startsWith(`${root}/`)) return [];
  const segments = path.slice(root.length + 1).split("/").slice(0, -1);
  return segments.map((_, index) => `${root}/${segments.slice(0, index + 1).join("/")}`);
}
