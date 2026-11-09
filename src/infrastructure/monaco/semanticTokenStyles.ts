import type { ThemeRegistrationRaw } from "shiki";
import kanagawaDragon from "./kanagawa-dragon-color-theme.json";

/**
 * 言語サーバーが返す「意味に基づく色分け」（semantic tokens）の色を、VS Code と同じ手順で決める。
 * 1. テーマの semanticTokenColors に合うものがあれば使う
 * 2. 決まらなかった色や形は、対応表で TextMate の分類に読み替え、テーマの tokenColors のものを使う
 * 3. どちらにもなければ色を変えず、TextMate 文法の色のまま
 * 種類の親（rust-analyzer の selfKeyword なら keyword）に向けたルールも効く。言語ごとのルールもある。
 *
 * Monaco 単体は「種類.修飾.修飾」の文字列をテーマのルールと頭から照らし合わせるだけで、この手順を持たない。
 * そこで色をここで決め、Monaco には色と形ごとの名前（semantic.<色>.<形>）として渡す。
 */

/** 色と文字の形。決まらなかったもの（undefined）は、TextMate 文法の側のまま */
type Style = { foreground?: string; bold?: boolean; italic?: boolean; underline?: boolean; strikethrough?: boolean };
type TokenColorRule = { scope?: string | string[]; settings: { foreground?: string; fontStyle?: string } };
type SemanticColor = string | { foreground?: string; fontStyle?: string; bold?: boolean; italic?: boolean; underline?: boolean; strikethrough?: boolean };

const tokenColors = kanagawaDragon.tokenColors as TokenColorRule[];
const semanticTokenColors = kanagawaDragon.semanticTokenColors as Record<string, SemanticColor>;

const FONT_FLAGS = ["bold", "italic", "underline", "strikethrough"] as const;

/**
 * 種類の親。親に向けたルールは子にも効く（点数は下がる）。VS Code 本体のものと、rust-analyzer の拡張機能が
 * 登録するもの（rust-analyzer の editors/code/package.json の semanticTokenTypes、MIT / Apache-2.0）
 */
const SUPER_TYPES: Record<string, string> = {
  member: "method",
  angle: "punctuation",
  arithmetic: "operator",
  attributeBracket: "punctuation",
  bitwise: "operator",
  boolean: "keyword",
  brace: "punctuation",
  bracket: "punctuation",
  builtinAttribute: "attribute",
  builtinType: "type",
  character: "string",
  colon: "punctuation",
  comma: "punctuation",
  comparison: "operator",
  const: "variable",
  derive: "attribute",
  deriveHelper: "attribute",
  dot: "punctuation",
  logical: "operator",
  macroBang: "punctuation",
  parenthesis: "punctuation",
  procMacro: "macro",
  operator: "punctuation",
  selfKeyword: "keyword",
  selfTypeKeyword: "keyword",
  semicolon: "punctuation",
  static: "variable",
  toolModule: "decorator",
  typeAlias: "type",
  union: "type",
};

/**
 * テーマに色がないときに使う、TextMate の分類への読み替え。前にあるものから登録した順に並べる（点数が同じなら後ろが勝つ）。
 * VS Code の既定のもの（src/vs/platform/theme/common/tokenClassificationRegistry.ts）のあとに、
 * rust-analyzer の拡張機能のもの（package.json の semanticTokenScopes）。候補は前から順に、色の決まるものを使う
 */
const TEXTMATE_SCOPES: [selector: string, scopes: string[]][] = [
  ["comment", ["comment"]],
  ["string", ["string"]],
  ["keyword", ["keyword.control"]],
  ["number", ["constant.numeric"]],
  ["regexp", ["constant.regexp"]],
  ["operator", ["keyword.operator"]],
  ["namespace", ["entity.name.namespace"]],
  ["type", ["entity.name.type", "support.type"]],
  ["struct", ["entity.name.type.struct"]],
  ["class", ["entity.name.type.class", "support.class"]],
  ["interface", ["entity.name.type.interface"]],
  ["enum", ["entity.name.type.enum"]],
  ["typeParameter", ["entity.name.type.parameter"]],
  ["function", ["entity.name.function", "support.function"]],
  ["method", ["entity.name.function.member", "support.function"]],
  ["macro", ["entity.name.function.preprocessor"]],
  ["variable", ["variable.other.readwrite", "entity.name.variable"]],
  ["parameter", ["variable.parameter"]],
  ["property", ["variable.other.property"]],
  ["enumMember", ["variable.other.enummember"]],
  ["event", ["variable.other.event"]],
  ["decorator", ["entity.name.decorator", "entity.name.function"]],
  ["variable.readonly", ["variable.other.constant"]],
  ["property.readonly", ["variable.other.constant.property"]],
  ["type.defaultLibrary", ["support.type"]],
  ["class.defaultLibrary", ["support.class"]],
  ["interface.defaultLibrary", ["support.class"]],
  ["variable.defaultLibrary", ["support.variable", "support.other.variable"]],
  ["variable.defaultLibrary.readonly", ["support.constant"]],
  ["property.defaultLibrary", ["support.variable.property"]],
  ["property.defaultLibrary.readonly", ["support.constant.property"]],
  ["function.defaultLibrary", ["support.function"]],
  ["member.defaultLibrary", ["support.function"]],
  ["attribute:rust", ["meta.attribute.rust"]],
  ["boolean:rust", ["constant.language.boolean.rust"]],
  ["builtinType:rust", ["support.type.primitive.rust"]],
  ["constParameter:rust", ["constant.other.caps.rust"]],
  ["enum:rust", ["entity.name.type.enum.rust"]],
  ["formatSpecifier:rust", ["punctuation.section.embedded.rust"]],
  ["function:rust", ["entity.name.function.rust"]],
  ["interface:rust", ["entity.name.type.trait.rust"]],
  ["keyword:rust", ["keyword.other.rust"]],
  ["keyword.controlFlow:rust", ["keyword.control.rust"]],
  ["lifetime:rust", ["storage.modifier.lifetime.rust"]],
  ["macroBang:rust", ["entity.name.function.macro.rust"]],
  ["method:rust", ["entity.name.function.rust"]],
  ["struct:rust", ["entity.name.type.struct.rust"]],
  ["typeAlias:rust", ["entity.name.type.declaration.rust"]],
  ["union:rust", ["entity.name.type.union.rust"]],
  ["variable:rust", ["variable.other.rust"]],
  ["variable.constant:rust", ["variable.other.constant.rust"]],
  // 書き換えられる変数に下線を引く
  ["*.mutable:rust", ["markup.underline"]],
];

const normalize = (color: string) => color.toLowerCase().replace(/^#/, "");

/** VS Code と同じく、fontStyle が書いてあれば 4 つとも決まる（書いていないものは「なし」） */
function toStyle(foreground: string | undefined, fontStyle: string | undefined, flags: Partial<Record<(typeof FONT_FLAGS)[number], boolean>> = {}): Style {
  const style: Style = { foreground: foreground && normalize(foreground), ...flags };
  if (fontStyle !== undefined) for (const flag of FONT_FLAGS) style[flag] = fontStyle.includes(flag);
  return style;
}

/**
 * TextMate のテーマと同じく、分類の頭から最も長く一致するルールの色と形。同じ長さなら後ろのルールが勝つ。
 * 色と形は別々に決める
 */
function textMateStyle(scope: string): Style | null {
  let foreground: { length: number; value: string } | null = null;
  let fontStyle: { length: number; value: string } | null = null;
  for (const rule of tokenColors) {
    const settings = rule.settings;
    const selectors = Array.isArray(rule.scope) ? rule.scope : rule.scope ? rule.scope.split(",") : [];
    for (const selector of selectors.map((s) => s.trim())) {
      // 親の分類を条件にするもの（"source.css support.type" など）は、意味の色分けの読み替えには使わない
      if (selector.includes(" ")) continue;
      if (scope !== selector && !scope.startsWith(`${selector}.`)) continue;
      const length = selector.split(".").length;
      if (settings.foreground && (!foreground || length >= foreground.length)) foreground = { length, value: settings.foreground };
      if (settings.fontStyle !== undefined && (!fontStyle || length >= fontStyle.length)) fontStyle = { length, value: settings.fontStyle };
    }
  }
  if (!foreground && !fontStyle) return null;
  return toStyle(foreground?.value, fontStyle?.value);
}

type Selector = { type: string; modifiers: string[]; language?: string };

/** "種類.修飾.修飾:言語" */
function parseSelector(text: string): Selector {
  const [classifier, language] = text.split(":");
  const [type, ...modifiers] = classifier.split(".");
  return { type, modifiers, language };
}

/**
 * VS Code の点数の付け方（TokenClassificationRegistry.parseTokenSelector）。合わなければ -1。
 * 言語が合えば 10、種類が合えば 100（親で合えば、1 段ごとに 1 引く）、修飾は 1 つにつき 100
 */
function matchScore(selector: Selector, type: string, modifiers: string[], language: string): number {
  let score = 0;
  if (selector.language !== undefined) {
    if (selector.language !== language) return -1;
    score += 10;
  }
  if (selector.type !== "*") {
    let level = 0;
    let current: string | undefined = type;
    while (current !== undefined && current !== selector.type) {
      current = SUPER_TYPES[current];
      level++;
    }
    if (current === undefined) return -1;
    score += 100 - level;
  }
  if (!selector.modifiers.every((modifier) => modifiers.includes(modifier))) return -1;
  return score + selector.modifiers.length * 100;
}

const THEME_RULES = Object.entries(semanticTokenColors).map(([selector, color]) => ({
  selector: parseSelector(selector),
  style:
    typeof color === "string"
      ? toStyle(color, undefined)
      : toStyle(color.foreground, color.fontStyle, {
          bold: color.bold,
          italic: color.italic,
          underline: color.underline,
          strikethrough: color.strikethrough,
        }),
}));

const DEFAULT_RULES = TEXTMATE_SCOPES.map(([selector, scopes]) => ({ selector: parseSelector(selector), scopes }));

/**
 * VS Code の手順（ColorThemeData.getTokenStyle）。色と形の 4 つを、それぞれ点数の最も高いルールで決める。
 * テーマの semanticTokenColors で決まったものはそのまま使い、決まらなかったものだけ TextMate の分類への読み替えで決める
 */
function resolveStyle(type: string, modifiers: string[], language: string): Style {
  const result: Style = {};
  const scores: Record<keyof Style, number> = { foreground: -1, bold: -1, italic: -1, underline: -1, strikethrough: -1 };
  const apply = (score: number, style: Style) => {
    for (const key of Object.keys(scores) as (keyof Style)[]) {
      const value = style[key];
      if (value === undefined || scores[key] > score) continue;
      scores[key] = score;
      (result as Record<string, unknown>)[key] = value;
    }
  };
  for (const rule of THEME_RULES) {
    const score = matchScore(rule.selector, type, modifiers, language);
    if (score >= 0) apply(score, rule.style);
  }
  for (const key of Object.keys(scores) as (keyof Style)[]) if (scores[key] !== -1) scores[key] = Infinity;
  for (const rule of DEFAULT_RULES) {
    const score = matchScore(rule.selector, type, modifiers, language);
    if (score < 0) continue;
    const style = rule.scopes.map(textMateStyle).find((found) => found !== null);
    if (style) apply(score, style);
  }
  return result;
}

const FONT_STYLES: string[] = (() => {
  const combinations = [""];
  for (const flag of FONT_FLAGS) for (const combination of [...combinations]) combinations.push(`${combination} ${flag}`.trim());
  return combinations;
})();

const fontStyleOf = (style: Style) => FONT_FLAGS.filter((flag) => style[flag]).join(" ");

const tokenName = (foreground: string, fontStyle: string) =>
  ["semantic", foreground, ...fontStyle.split(" ").filter(Boolean)].join(".");

/**
 * 使いうる色はテーマにある色だけなので、色と形の組み合わせを先に全部並べて Monaco に渡す名前の一覧（legend）にする。
 * 色と形は別々のルールから来ることがある（rust-analyzer の書き換えられる変数は、テーマの変数の色に下線）
 */
const FOREGROUNDS: string[] = [
  ...new Set(
    [...tokenColors.map((rule) => rule.settings.foreground), ...THEME_RULES.map((rule) => rule.style.foreground)]
      .filter((color): color is string => color !== undefined)
      .map(normalize),
  ),
];

const STYLES = FOREGROUNDS.flatMap((foreground) => FONT_STYLES.map((fontStyle) => ({ foreground, fontStyle })));

export const SEMANTIC_TOKEN_LEGEND: string[] = STYLES.map((style) => tokenName(style.foreground, style.fontStyle));

/** テーマに足すルール。TextMate 文法がこの名前の分類を出すことはないので、ほかの色には影響しない */
export const SEMANTIC_THEME_SETTINGS: ThemeRegistrationRaw["settings"] = STYLES.map((style) => ({
  scope: tokenName(style.foreground, style.fontStyle),
  settings: { foreground: `#${style.foreground}`, fontStyle: style.fontStyle },
}));

const cache = new Map<string, number | null>();

/**
 * 種類と修飾に付ける色の、SEMANTIC_TOKEN_LEGEND での位置。色を変えないなら null。
 * 言語は VS Code の言語の ID（rust、typescript など）。
 * Monaco は色の決まらない部分だけ TextMate 文法の側を残す、ということができないので、色が決まらなければ形も付けない
 */
export function semanticStyleIndex(type: string, modifiers: string[], language: string): number | null {
  const key = [language, type, ...modifiers].join(".");
  if (!cache.has(key)) {
    const style = resolveStyle(type, modifiers, language);
    cache.set(key, style.foreground ? SEMANTIC_TOKEN_LEGEND.indexOf(tokenName(style.foreground, fontStyleOf(style))) : null);
  }
  return cache.get(key) ?? null;
}
