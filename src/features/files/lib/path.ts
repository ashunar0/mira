export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function parentPath(path: string): string {
  return path.slice(0, path.lastIndexOf("/")) || "/";
}

/** path が base そのものか、その中にある */
export function isWithin(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/** from 以下にある path を、to 以下の同じ位置へ読み替える */
export function rebasePath(path: string, from: string, to: string): string {
  return isWithin(path, from) ? `${to}${path.slice(from.length)}` : path;
}

/** root より下、path より上のディレクトリを root に近い順に返す */
export function ancestorsWithin(root: string, path: string): string[] {
  if (!path.startsWith(`${root}/`)) return [];
  const segments = path.slice(root.length + 1).split("/").slice(0, -1);
  return segments.map((_, index) => `${root}/${segments.slice(0, index + 1).join("/")}`);
}
