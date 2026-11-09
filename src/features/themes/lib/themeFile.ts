import { parse } from "jsonc-parser";
import type { SemanticColor, TokenColorRule } from "../../../infrastructure/monaco/semanticTokenStyles";
import type { ColorThemeData } from "../../../infrastructure/monaco/theme";
import { themeKindOf } from "../../../infrastructure/theme/workbenchColors";

type ThemeFile = {
  include?: unknown;
  colors?: unknown;
  tokenColors?: unknown;
  semanticHighlighting?: unknown;
  semanticTokenColors?: unknown;
  settings?: unknown;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function resolveRelative(from: string, relative: string): string {
  const parts = from.split("/").slice(0, -1);
  for (const segment of relative.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment !== "." && segment !== "") parts.push(segment);
  }
  return parts.join("/");
}

/**
 * VS Code と同じ手順（colorThemeData.ts の _loadColorTheme）で、テーマのファイルを 1 つにまとめる。
 * include の先を先に読み、後から読んだ色が勝つ。tokenColors は前に足していく。
 * tokenColors にファイルを指定するもの（tmTheme）と、古い形式（settings）の全体の色には未対応で、飛ばす
 */
export async function loadColorTheme(
  path: string,
  uiTheme: string | null,
  read: (path: string) => Promise<string>,
): Promise<ColorThemeData> {
  const result: ColorThemeData = {
    kind: themeKindOf(uiTheme ?? undefined),
    colors: {},
    tokenColors: [],
    semanticHighlighting: false,
    semanticTokenColors: {},
  };

  const load = async (file: string, depth: number): Promise<void> => {
    if (depth > 10) throw new Error(`theme include is too deep: ${file}`);
    const content = parse(await read(file), [], { allowTrailingComma: true }) as unknown;
    if (!isObject(content)) throw new Error(`invalid theme file: ${file}`);
    const theme = content as ThemeFile;
    if (typeof theme.include === "string") await load(resolveRelative(file, theme.include), depth + 1);
    if (Array.isArray(theme.settings)) {
      result.tokenColors.push(...(theme.settings as TokenColorRule[]).filter((rule) => rule.scope !== undefined));
      return;
    }
    result.semanticHighlighting ||= theme.semanticHighlighting === true;
    if (isObject(theme.colors)) {
      for (const [id, value] of Object.entries(theme.colors)) {
        if (value === "default") delete result.colors[id];
        else if (typeof value === "string") result.colors[id] = value;
      }
    }
    if (Array.isArray(theme.tokenColors)) result.tokenColors.push(...(theme.tokenColors as TokenColorRule[]));
    else if (typeof theme.tokenColors === "string") console.warn(`tmTheme is not supported: ${theme.tokenColors}`);
    if (isObject(theme.semanticTokenColors)) {
      Object.assign(result.semanticTokenColors, theme.semanticTokenColors as Record<string, SemanticColor>);
    }
  };

  await load(path, 0);
  return result;
}
