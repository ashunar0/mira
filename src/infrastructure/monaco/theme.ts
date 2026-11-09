import { type ThemeKind, applyCssVariables, resolveWorkbenchColors, themeKindOf } from "../theme/workbenchColors";
import kanagawaDragon from "./kanagawa-dragon-color-theme.json";
import { type SemanticColor, type TokenColorRule, setSemanticTheme } from "./semanticTokenStyles";
import { switchCodeTheme } from "./syntaxHighlighting";

/** VS Code のテーマのファイルを、include をたどって 1 つにまとめたもの */
export type ColorThemeData = {
  kind: ThemeKind;
  colors: Record<string, string>;
  tokenColors: TokenColorRule[];
  semanticHighlighting: boolean;
  semanticTokenColors: Record<string, SemanticColor>;
};

/**
 * 設定のテーマが見つからないとき（VS Code がない、テーマを消した）と、起動してテーマを読み終えるまでに使う。
 * Kanagawa Dragon（metaphore.kanagawa-vscode-color-theme、MIT。ライセンスは同じフォルダの LICENSE.txt）
 */
export const BUNDLED_THEME: ColorThemeData = {
  kind: themeKindOf("vs-dark"),
  colors: kanagawaDragon.colors,
  tokenColors: kanagawaDragon.tokenColors as TokenColorRule[],
  semanticHighlighting: kanagawaDragon.semanticHighlighting,
  semanticTokenColors: kanagawaDragon.semanticTokenColors as Record<string, SemanticColor>,
};

let applied: { theme: ColorThemeData; customColors: Record<string, string> } | null = null;

/**
 * テーマを画面とエディタに当てる。VS Code と同じく、テーマの colors にユーザーの colorCustomizations を重ね、
 * 決まらない色は VS Code の既定値で埋める。画面には --vscode-* の変数で、エディタには Monaco のテーマで渡す
 */
export function applyColorTheme(theme: ColorThemeData, customColors: Record<string, string>): void {
  if (applied?.theme === theme && JSON.stringify(applied.customColors) === JSON.stringify(customColors)) return;
  applied = { theme, customColors };

  const colors = resolveWorkbenchColors(theme.kind, { ...theme.colors, ...customColors });
  applyCssVariables(colors);
  // スクロールバーや入力欄など、ブラウザが描く部分の明るさ
  document.documentElement.style.colorScheme = theme.kind === "light" || theme.kind === "hcLight" ? "light" : "dark";

  const semanticSettings = setSemanticTheme({
    enabled: theme.semanticHighlighting,
    tokenColors: theme.tokenColors,
    semanticTokenColors: theme.semanticTokenColors,
  });
  switchCodeTheme({
    type: theme.kind === "light" || theme.kind === "hcLight" ? "light" : "dark",
    // 意味に基づく色分けの色は後ろに足す（同じ色の TextMate の分類を先に見つけてもらうため）
    settings: [...theme.tokenColors, ...semanticSettings],
    colors,
  });
}
