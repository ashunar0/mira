import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import CssWorker from "monaco-editor/languages/features/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/languages/features/html/html.worker.js?worker";
import JsonWorker from "monaco-editor/languages/features/json/json.worker.js?worker";
import TsWorker from "monaco-editor/languages/features/typescript/ts.worker.js?worker";
import { installHoverCopyFeedback } from "./hoverCopyFeedback";
import { THEME_NAME } from "./theme";

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case "json":
        return new JsonWorker();
      case "css":
      case "scss":
      case "less":
        return new CssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new HtmlWorker();
      case "typescript":
      case "javascript":
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  },
};

installHoverCopyFeedback();

// 型エラー・ホバー・定義は typescript-language-server が受け持つ（features/lsp）。組み込みのものは 1 ファイルしか
// 見ないうえ、設定は言語を最初に使うときにしか読まれず後から切り替えられないので、最初から止めておく
for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  defaults.setModeConfiguration({ ...defaults.modeConfiguration, diagnostics: false, hovers: false, definitions: false });
}

// フォントは VS Code の macOS での既定値に合わせ、行間は好みで広めにとる
const SHARED_OPTIONS = {
  theme: THEME_NAME,
  automaticLayout: true,
  fontFamily: "Menlo, Monaco, 'Courier New', monospace",
  fontSize: 12,
  lineHeight: 22,
  stickyScroll: { enabled: true },
  // カーソルのある行は、行番号の色で分かる
  renderLineHighlight: "none" as const,
  // VS Code と同じく、言語サーバーの「意味に基づく色分け」を TextMate 文法の色に重ねる（Kanagawa Dragon が有効にしている）
  "semanticHighlighting.enabled": true,
};

export const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  ...SHARED_OPTIONS,
  model: null,
};

// 左右に並べて増減が色で分かるだけにする。行を戻す矢印やメニューなどの操作は出さない。
// 変更の位置は diff 専用の列を置かず、スクロールバーの印で示す（DiffPane）
export const DIFF_EDITOR_OPTIONS: monaco.editor.IStandaloneDiffEditorConstructionOptions = {
  ...SHARED_OPTIONS,
  useInlineViewWhenSpaceIsLimited: false,
  enableSplitViewResizing: false,
  renderMarginRevertIcon: false,
  renderGutterMenu: false,
  renderIndicators: false,
  renderOverviewRuler: false,
  // 折りたたみがない分の幅を足して、普段のエディタとコードの位置を揃える
  lineDecorationsWidth: 26,
  overviewRulerLanes: 1,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  minimap: { enabled: false },
  // 空白だけの変更も隠さない
  ignoreTrimWhitespace: false,
};

export { monaco };

/**
 * diff エディタを捨てる。DiffPane と、変更の印の計算（useGitGutter）はこれで捨てる。
 *
 * Monaco 単体はエディタを作るたびに、ホバーの部品（ボタンのツールチップなど）の作り方を、そのエディタの内部の
 * 仕組みに紐づけて登録し直す（VS Code 本体にはない仮の仕組み）。diff エディタの中の 2 つのエディタは diff 専用の
 * 仕組みに紐づくので、diff エディタを捨てると、片付け済みの仕組みを指したまま残る。すると型エラーの上のホバー
 * （下にボタンが並ぶ）が組み立てに失敗して出なくなる。全体の仕組みで作るエディタを一瞬作って、登録を戻す。
 */
export function disposeDiffEditor(diffEditor: monaco.editor.IStandaloneDiffEditor): void {
  diffEditor.dispose();
  monaco.editor.create(document.createElement("div"), { model: null }).dispose();
}
