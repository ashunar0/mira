import { parse, type ParseError } from "jsonc-parser";
import { deepMerge, getPath, isPlainObject, type ObjectTree } from "../../../infrastructure/objectTree";
import type { Settings } from "../type";

/** "[markdown]" や "[markdown][yaml]" のような、言語ごとの上書き。colorCustomizations のテーマごとの上書きも同じ形 */
const LANGUAGE_OVERRIDE = /^(\[[^\]]+\])+$/;

/**
 * VS Code と同じく、"editor.minimap.enabled" のようなドット区切りの名前を入れ子に直す。
 * 値の中の名前は分けない（"files.associations" の "*.mdx" のように、ドットを含む名前があるため）
 */
function toValuesTree(flat: ObjectTree): ObjectTree {
  let tree: ObjectTree = {};
  for (const [key, value] of Object.entries(flat)) {
    const nested = key.split(".").reduceRight<unknown>((inner, segment) => ({ [segment]: inner }), value);
    tree = deepMerge(tree, nested as ObjectTree);
  }
  return tree;
}

/** VS Code と同じく、書き損じがあっても読めた部分は使う。エラーは開いたファイルの波線で分かる */
export function parseSettings(text: string): Settings {
  const errors: ParseError[] = [];
  const root: unknown = parse(text, errors, { allowTrailingComma: true });
  const settings: Settings = { values: {}, languageOverrides: [] };
  if (!isPlainObject(root)) return settings;

  const plain: ObjectTree = {};
  for (const [key, value] of Object.entries(root)) {
    if (LANGUAGE_OVERRIDE.test(key)) {
      if (!isPlainObject(value)) continue;
      const languages = key.slice(1, -1).split("][");
      settings.languageOverrides.push({ languages, values: toValuesTree(value) });
    } else {
      plain[key] = value;
    }
  }
  settings.values = toValuesTree(plain);
  return settings;
}

/** 後ろの設定を優先して重ねる。言語ごとの上書きは、どの層のものも普通の設定より強い（VS Code と同じ） */
export function layerSettings(lower: Settings, upper: Settings): Settings {
  return {
    values: deepMerge(lower.values, upper.values),
    languageOverrides: [...lower.languageOverrides, ...upper.languageOverrides],
  };
}

/**
 * Mira の言語の名前と VS Code の言語の名前が違うもの。Mira は色の付け方のために .tsx と .jsx を別の言語にして
 * いて（syntaxHighlighting）、シェルは Monaco の名前を使っている。設定の "[typescriptreact]" などは VS Code の名前で書く
 */
const VSCODE_LANGUAGE_IDS: Record<string, string> = {
  tsx: "typescriptreact",
  jsx: "javascriptreact",
  shell: "shellscript",
};

/** 設定の値。"yaml.schemas" のようなドット区切りの名前で */
export function settingValue(settings: Settings, section: string): unknown {
  return getPath(settings.values, section);
}

/** ある言語のファイルで効く `editor.*` の値。言語は Monaco の名前で渡す。言語ごとの上書きは、書いた順に重ねる */
export function editorSettingsFor(settings: Settings, monacoLanguageId: string | null): ObjectTree {
  return languageSettingsFor(settings, monacoLanguageId, "editor");
}

/** ある言語のファイルで効く、name（"editor"、"files" など）の下の値 */
export function languageSettingsFor(settings: Settings, monacoLanguageId: string | null, name: string): ObjectTree {
  const languageId = monacoLanguageId && (VSCODE_LANGUAGE_IDS[monacoLanguageId] ?? monacoLanguageId);
  const section = (values: ObjectTree) => (isPlainObject(values[name]) ? values[name] : {});
  return settings.languageOverrides
    .filter((override) => languageId !== null && override.languages.includes(languageId))
    .reduce((merged, override) => deepMerge(merged, section(override.values)), section(settings.values));
}

/** workbench.colorTheme。書いていなければ null（mira に入れてあるテーマを使う） */
export function colorThemeOf(settings: Settings): string | null {
  const workbench = settings.values.workbench;
  return isPlainObject(workbench) && typeof workbench.colorTheme === "string" ? workbench.colorTheme : null;
}

/** "[Kanagawa*]" のような、テーマの名前の * を含むものも合わせる（VS Code の themeSpecific と同じ） */
function matchesTheme(scope: string, themeId: string): boolean {
  const pattern = new RegExp(`^${scope.replace(/[.+?^${}()|\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  return pattern.test(themeId);
}

/**
 * workbench.colorCustomizations のうち、このテーマで効く色。VS Code と同じく、テーマを問わないものに
 * "[テーマの名前]" の中のものを重ねる。"[A][B]" のように並べれば、どちらのテーマでも効く
 */
export function colorCustomizationsFor(settings: Settings, themeId: string | null): Record<string, string> {
  const workbench = settings.values.workbench;
  const customizations = isPlainObject(workbench) ? workbench.colorCustomizations : undefined;
  if (!isPlainObject(customizations)) return {};
  const colors: Record<string, string> = {};
  const themeSpecific: Record<string, string> = {};
  for (const [key, value] of Object.entries(customizations)) {
    if (typeof value === "string") {
      colors[key] = value;
    } else if (themeId !== null && isPlainObject(value) && LANGUAGE_OVERRIDE.test(key)) {
      const scopes = key.slice(1, -1).split("][");
      if (!scopes.some((scope) => matchesTheme(scope, themeId))) continue;
      for (const [id, color] of Object.entries(value)) if (typeof color === "string") themeSpecific[id] = color;
    }
  }
  return { ...colors, ...themeSpecific };
}
