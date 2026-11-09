import { isPlainObject } from "../../../infrastructure/objectTree";

/** "source.fixAll" は "source.fixAll" と "source.fixAll.ruff" を含む。空は全部を含む（VS Code の HierarchicalKind） */
export function kindContains(outer: string, inner: string): boolean {
  return outer === "" || inner === outer || inner.startsWith(`${outer}.`);
}

/**
 * editor.codeActionsOnSave から、手で保存したときに動かすコードアクションの種類と、除く種類。
 * VS Code と同じ手順（saveParticipants.ts の CodeActionOnSaveParticipant）:
 * - 値が "explicit" / "always" / true のものを動かし、"never" のものは除く。配列ならすべて動かす
 * - ほかの種類に含まれるもの（source.fixAll があるときの source.fixAll.ruff）は外す
 * - source.fixAll に含まれるものを先に動かす（配列のときは書いた順のまま）
 */
export function codeActionsOnSave(setting: unknown): { kinds: string[]; excludes: string[] } {
  if (Array.isArray(setting)) {
    const kinds = setting.filter((item): item is string => typeof item === "string");
    return { kinds: removeSubsets(kinds), excludes: [] };
  }
  if (!isPlainObject(setting)) return { kinds: [], excludes: [] };
  const entries = Object.entries(setting);
  const enabled = entries.filter(([, value]) => value && value !== "never").map(([kind]) => kind);
  const run = new Set(entries.filter(([, value]) => value === true || value === "explicit" || value === "always").map(([kind]) => kind));
  const kinds = removeSubsets(enabled)
    .filter((kind) => run.has(kind))
    .sort((a, b) => Number(kindContains("source.fixAll", b)) - Number(kindContains("source.fixAll", a)));
  return { kinds, excludes: entries.filter(([, value]) => value === "never").map(([kind]) => kind) };
}

function removeSubsets(kinds: string[]): string[] {
  return kinds.filter((kind) => kinds.every((other) => other === kind || !kindContains(other, kind)));
}
