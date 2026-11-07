import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import CssWorker from "monaco-editor/languages/features/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/languages/features/html/html.worker.js?worker";
import JsonWorker from "monaco-editor/languages/features/json/json.worker.js?worker";
import TsWorker from "monaco-editor/languages/features/typescript/ts.worker.js?worker";
import { installHoverCopyFeedback } from "./hoverCopyFeedback";
import { DARK_MODERN } from "./theme";

const THEME_NAME = "dark-modern";

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

monaco.editor.defineTheme(THEME_NAME, DARK_MODERN);
installHoverCopyFeedback();

// Monaco はプロジェクトの tsconfig も node_modules も知らないので、意味解析を動かすと import が
// 軒並み赤線になる。LSP を入れるまでは構文エラーだけ出す。
const diagnostics = { noSemanticValidation: true, noSyntaxValidation: false };
monaco.typescript.typescriptDefaults.setDiagnosticsOptions(diagnostics);
monaco.typescript.javascriptDefaults.setDiagnosticsOptions(diagnostics);

// フォントは VS Code の macOS での既定値に合わせ、行間は好みで広めにとる
const SHARED_OPTIONS = {
  theme: THEME_NAME,
  automaticLayout: true,
  fontFamily: "Menlo, Monaco, 'Courier New', monospace",
  fontSize: 12,
  lineHeight: 22,
  stickyScroll: { enabled: true },
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
  overviewRulerLanes: 1,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  minimap: { enabled: false },
  // 空白だけの変更も隠さない
  ignoreTrimWhitespace: false,
};

export { monaco };
