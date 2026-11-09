import { Color } from "./color";
import defaults from "./vscodeColorDefaults.json";

// テーマが決めていない画面の色を、VS Code と同じ既定値で埋める（src/vs/platform/theme/common/colorUtils.ts の
// resolveColorValue と executeTransform と同じ手順）。既定値の表は scripts/generate-vscode-color-defaults.mjs で作る

export type ThemeKind = "dark" | "light" | "hcDark" | "hcLight";

type ColorValue =
  | string
  | null
  | { op: "darken" | "lighten" | "transparent"; value: ColorValue; factor: number }
  | { op: "opacity"; value: ColorValue; opacity: number }
  | { op: "opaque"; value: ColorValue; background: ColorValue }
  | { op: "oneOf"; values: ColorValue[] }
  | { op: "ifDefinedThenElse"; if: string; then: ColorValue; else: ColorValue }
  | { op: "lessProminent"; value: ColorValue; background: ColorValue; factor: number; transparency: number }
  | { op: "mix"; color: ColorValue; with: ColorValue; ratio?: number };

const DEFAULTS = defaults as unknown as Record<string, Record<ThemeKind, ColorValue>>;

/** VS Code の uiTheme（package.json の contributes.themes）から */
export function themeKindOf(uiTheme: string | undefined): ThemeKind {
  if (uiTheme === "vs") return "light";
  if (uiTheme === "hc-black") return "hcDark";
  if (uiTheme === "hc-light") return "hcLight";
  return "dark";
}

/**
 * 画面の色をすべて求める。defined はテーマの colors にユーザーの colorCustomizations を重ねたもの。
 * 返すのは VS Code に登録された色と、テーマにだけある色のすべて。決まらない色は入れない
 */
export function resolveWorkbenchColors(kind: ThemeKind, defined: Record<string, string>): Record<string, string> {
  const parsed = new Map<string, Color>();
  for (const [id, value] of Object.entries(defined)) {
    const color = typeof value === "string" ? Color.parse(value) : null;
    if (color) parsed.set(id, color);
  }

  const cache = new Map<string, Color | undefined>();
  const resolving = new Set<string>();

  const getColor = (id: string): Color | undefined => {
    if (parsed.has(id)) return parsed.get(id);
    if (cache.has(id)) return cache.get(id);
    // 既定値が互いを指し合っていても止まるように
    if (resolving.has(id)) return undefined;
    resolving.add(id);
    const color = resolve(DEFAULTS[id]?.[kind] ?? null);
    resolving.delete(id);
    cache.set(id, color);
    return color;
  };

  const resolve = (value: ColorValue): Color | undefined => {
    if (value === null) return undefined;
    if (typeof value === "string") return value.startsWith("#") ? (Color.parse(value) ?? undefined) : getColor(value);
    switch (value.op) {
      case "darken":
        return resolve(value.value)?.darken(value.factor);
      case "lighten":
        return resolve(value.value)?.lighten(value.factor);
      case "transparent":
        return resolve(value.value)?.transparent(value.factor);
      case "opacity":
        return resolve(value.value)?.withOpacity(value.opacity);
      case "mix":
        return (resolve(value.color) ?? Color.ofRgba(0, 0, 0, 0)).mix(resolve(value.with) ?? Color.ofRgba(0, 0, 0, 0), value.ratio);
      case "opaque": {
        const background = resolve(value.background);
        const color = resolve(value.value);
        return background ? color?.makeOpaque(background) : color;
      }
      case "oneOf":
        for (const candidate of value.values) {
          const color = resolve(candidate);
          if (color) return color;
        }
        return undefined;
      case "ifDefinedThenElse":
        return resolve(parsed.has(value.if) ? value.then : value.else);
      case "lessProminent": {
        const from = resolve(value.value);
        if (!from) return undefined;
        const background = resolve(value.background);
        if (!background) return from.transparent(value.factor * value.transparency);
        return from.isDarkerThan(background)
          ? Color.lighterThan(from, background, value.factor).transparent(value.transparency)
          : Color.darkerThan(from, background, value.factor).transparent(value.transparency);
      }
    }
  };

  const colors: Record<string, string> = {};
  for (const id of new Set([...Object.keys(DEFAULTS), ...parsed.keys()])) {
    const color = getColor(id);
    if (color) colors[id] = color.toString();
  }
  return colors;
}

/** VS Code と同じ名前の CSS 変数にする（sideBar.background → --vscode-sideBar-background） */
export function applyCssVariables(colors: Record<string, string>, target: HTMLElement = document.documentElement) {
  for (const id of [...target.style].filter((name) => name.startsWith("--vscode-"))) target.style.removeProperty(id);
  for (const [id, value] of Object.entries(colors)) target.style.setProperty(`--vscode-${id.replace(/\./g, "-")}`, value);
}
