/** インストール済みの拡張機能か VS Code 本体にあるテーマ */
export type ColorThemeEntry = {
  /** workbench.colorTheme に書く名前。VS Code と同じく id、なければ label */
  settingsId: string;
  /** vs / vs-dark / hc-black / hc-light */
  uiTheme: string | null;
  path: string;
};
