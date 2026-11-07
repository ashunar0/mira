import type { ThemeRegistrationRaw } from "shiki";
import kanagawaDragon from "./kanagawa-dragon-color-theme.json";

/**
 * 言語サーバーが返す「意味に基づく色分け」（semantic tokens）の色を、VS Code と同じ手順で決める。
 * 1. テーマの semanticTokenColors に合うものがあれば使う
 * 2. なければ、VS Code の対応表で TextMate の分類に読み替え、テーマの tokenColors の色を使う
 * 3. どちらにもなければ色を変えず、TextMate 文法の色のまま
 *
 * Monaco 単体は「種類.修飾.修飾」の文字列をテーマのルールと頭から照らし合わせるだけで、この手順を持たない。
 * そこで色をここで決め、Monaco には色ごとの名前（semantic.<色>）として渡す。
 */

type Style = { foreground: string; fontStyle: string };
type TokenColorRule = { scope?: string | string[]; settings: { foreground?: string; fontStyle?: string } };
type SemanticColor = string | { foreground?: string; fontStyle?: string; bold?: boolean; italic?: boolean };

const tokenColors = kanagawaDragon.tokenColors as TokenColorRule[];
const semanticTokenColors = kanagawaDragon.semanticTokenColors as Record<string, SemanticColor>;

/**
 * VS Code の既定の対応表（src/vs/platform/theme/common/tokenClassificationRegistry.ts）。
 * 修飾つきの行は、その修飾がすべて付いているときに使う。候補は前から順に、色の決まるものを使う
 */
const TEXTMATE_SCOPES: Record<string, string[]> = {
  comment: ["comment"],
  string: ["string"],
  keyword: ["keyword.control"],
  number: ["constant.numeric"],
  regexp: ["constant.regexp"],
  operator: ["keyword.operator"],
  namespace: ["entity.name.namespace"],
  type: ["entity.name.type", "support.type"],
  struct: ["entity.name.type.struct"],
  class: ["entity.name.type.class", "support.class"],
  interface: ["entity.name.type.interface"],
  enum: ["entity.name.type.enum"],
  typeParameter: ["entity.name.type.parameter"],
  function: ["entity.name.function", "support.function"],
  member: ["entity.name.function.member", "support.function"],
  method: ["entity.name.function.member", "support.function"],
  macro: ["entity.name.function.preprocessor"],
  variable: ["variable.other.readwrite", "entity.name.variable"],
  parameter: ["variable.parameter"],
  property: ["variable.other.property"],
  enumMember: ["variable.other.enummember"],
  event: ["variable.other.event"],
  decorator: ["entity.name.decorator", "entity.name.function"],
  label: ["entity.name.label"],
  "variable.readonly": ["variable.other.constant"],
  "property.readonly": ["variable.other.constant.property"],
  "type.defaultLibrary": ["support.type"],
  "class.defaultLibrary": ["support.class"],
  "interface.defaultLibrary": ["support.class"],
  "variable.defaultLibrary": ["support.variable", "support.other.variable"],
  "variable.readonly.defaultLibrary": ["support.constant"],
  "property.defaultLibrary": ["support.variable.property"],
  "property.readonly.defaultLibrary": ["support.constant.property"],
  "function.defaultLibrary": ["support.function"],
  "member.defaultLibrary": ["support.function"],
  "method.defaultLibrary": ["support.function"],
};

const normalize = (color: string) => color.toLowerCase().replace(/^#/, "");

/** TextMate のテーマと同じく、分類の頭から最も長く一致するルールの色。同じ長さなら後ろのルールが勝つ */
function textMateStyle(scope: string): Style | null {
  let best: { length: number; style: Style } | null = null;
  for (const rule of tokenColors) {
    const { foreground, fontStyle = "" } = rule.settings;
    if (!foreground) continue;
    const selectors = Array.isArray(rule.scope) ? rule.scope : rule.scope ? rule.scope.split(",") : [];
    for (const selector of selectors.map((s) => s.trim())) {
      // 親の分類を条件にするもの（"source.css support.type" など）は、意味の色分けの読み替えには使わない
      if (selector.includes(" ")) continue;
      if (scope !== selector && !scope.startsWith(`${selector}.`)) continue;
      const length = selector.split(".").length;
      if (!best || length >= best.length) best = { length, style: { foreground: normalize(foreground), fontStyle } };
    }
  }
  return best?.style ?? null;
}

function toStyle(color: SemanticColor): Style | null {
  if (typeof color === "string") return { foreground: normalize(color), fontStyle: "" };
  if (!color.foreground) return null;
  const fontStyle = color.fontStyle ?? [color.bold && "bold", color.italic && "italic"].filter(Boolean).join(" ");
  return { foreground: normalize(color.foreground), fontStyle };
}

/** "種類.修飾.修飾" の形の候補から、種類が合い、修飾がすべて付いていて、修飾が最も多いもの */
function mostSpecific<T>(table: Record<string, T>, type: string, modifiers: string[]): T | null {
  let best: { score: number; value: T } | null = null;
  for (const [selector, value] of Object.entries(table)) {
    const [selectorType, ...selectorModifiers] = selector.split(":")[0].split(".");
    if (selectorType !== type && selectorType !== "*") continue;
    if (!selectorModifiers.every((modifier) => modifiers.includes(modifier))) continue;
    const score = (selectorType === "*" ? 0 : 100) + selectorModifiers.length;
    if (!best || score > best.score) best = { score, value };
  }
  return best?.value ?? null;
}

function resolveStyle(type: string, modifiers: string[]): Style | null {
  const themed = mostSpecific(semanticTokenColors, type, modifiers);
  if (themed) return toStyle(themed);
  const scopes = mostSpecific(TEXTMATE_SCOPES, type, modifiers) ?? [];
  for (const scope of scopes) {
    const style = textMateStyle(scope);
    if (style) return style;
  }
  return null;
}

const tokenName = (style: Style) =>
  ["semantic", style.foreground, ...style.fontStyle.split(" ").filter(Boolean)].join(".");

/** 使いうる色はテーマにある色だけなので、先に全部並べて Monaco に渡す名前の一覧（legend）にする */
const STYLES: Style[] = (() => {
  const styles = new Map<string, Style>();
  const add = (style: Style | null) => {
    if (style) styles.set(tokenName(style), style);
  };
  for (const rule of tokenColors) {
    if (rule.settings.foreground) {
      add({ foreground: normalize(rule.settings.foreground), fontStyle: rule.settings.fontStyle ?? "" });
    }
  }
  for (const color of Object.values(semanticTokenColors)) add(toStyle(color));
  return [...styles.values()];
})();

export const SEMANTIC_TOKEN_LEGEND: string[] = STYLES.map(tokenName);

/** テーマに足すルール。TextMate 文法がこの名前の分類を出すことはないので、ほかの色には影響しない */
export const SEMANTIC_THEME_SETTINGS: ThemeRegistrationRaw["settings"] = STYLES.map((style) => ({
  scope: tokenName(style),
  settings: { foreground: `#${style.foreground}`, fontStyle: style.fontStyle },
}));

const cache = new Map<string, number | null>();

/** 種類と修飾に付ける色の、SEMANTIC_TOKEN_LEGEND での位置。色を変えないなら null */
export function semanticStyleIndex(type: string, modifiers: string[]): number | null {
  const key = [type, ...modifiers].join(".");
  if (!cache.has(key)) {
    const style = resolveStyle(type, modifiers);
    cache.set(key, style ? SEMANTIC_TOKEN_LEGEND.indexOf(tokenName(style)) : null);
  }
  return cache.get(key) ?? null;
}
