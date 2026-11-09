import { parse, type ParseError } from "jsonc-parser";
import { deepMerge, isPlainObject, type ObjectTree } from "../../../infrastructure/objectTree";
import type { Settings } from "../type";

/** "[markdown]" や "[markdown][yaml]" のような、言語ごとの上書き */
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

/** ある言語のファイルで効く `editor.*` の値。言語ごとの上書きは、書いた順に重ねる */
export function editorSettingsFor(settings: Settings, languageId: string | null): ObjectTree {
  const section = (values: ObjectTree) => (isPlainObject(values.editor) ? values.editor : {});
  return settings.languageOverrides
    .filter((override) => languageId !== null && override.languages.includes(languageId))
    .reduce((merged, override) => deepMerge(merged, section(override.values)), section(settings.values));
}
