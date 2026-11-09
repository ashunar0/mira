import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import CssWorker from "monaco-editor/languages/features/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/languages/features/html/html.worker.js?worker";
import JsonWorker from "monaco-editor/languages/features/json/json.worker.js?worker";
import TsWorker from "monaco-editor/languages/features/typescript/ts.worker.js?worker";
import { installHoverCopyFeedback } from "./hoverCopyFeedback";
import { deepMerge, type ObjectTree, withResets } from "../objectTree";

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

// mira の既定値。ユーザーの設定（settings.json の editor.*）はこの上に重ねる。
// フォントは VS Code の macOS での既定値に合わせ、行間は好みで広めにとる
const DEFAULT_OPTIONS: ObjectTree = {
  automaticLayout: true,
  fontFamily: "Menlo, Monaco, 'Courier New', monospace",
  fontSize: 12,
  lineHeight: 22,
  stickyScroll: { enabled: true },
  // カーソルのある行は、行番号の色で分かる
  renderLineHighlight: "none",
  // 言語サーバーの「意味に基づく色分け」を TextMate 文法の色に重ねる。VS Code と同じく、するかはテーマが決める
  // （semanticTokenStyles。Monaco 単体はテーマから読めないので、ここでは常に有効にしておく）
  "semanticHighlighting.enabled": true,
};

// 左右に並べて増減が色で分かるだけにする。行を戻す矢印やメニューなどの操作は出さない。
// 変更の位置は diff 専用の列を置かず、スクロールバーの印で示す（DiffPane）。
// mira の diff の見せ方なので、ユーザーの設定より優先する
const DIFF_ONLY_OPTIONS: ObjectTree = {
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

/** エディタに渡す設定。userOptions は settings.json の editor.* を入れ子にしたもの */
export function editorOptions(userOptions: ObjectTree): monaco.editor.IEditorOptions {
  return deepMerge(DEFAULT_OPTIONS, userOptions);
}

export function diffEditorOptions(userOptions: ObjectTree): monaco.editor.IDiffEditorOptions {
  return deepMerge(deepMerge(DEFAULT_OPTIONS, userOptions), DIFF_ONLY_OPTIONS);
}

/** 作るときに渡す。テーマは全体で 1 つなので渡さない（applyColorTheme が替える） */
export const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  ...editorOptions({}),
  model: null,
};

export const DIFF_EDITOR_OPTIONS: monaco.editor.IStandaloneDiffEditorConstructionOptions = diffEditorOptions({});

/**
 * 設定を差し替える。updateOptions は渡した値しか変えないので、前に渡して今はない値は既定に戻す。
 * 戻り値を次の previous に渡す
 */
export function replaceOptions<T extends object>(
  editor: { updateOptions(options: T): void },
  previous: ObjectTree,
  next: T,
): ObjectTree {
  editor.updateOptions(withResets(previous, next as ObjectTree) as T);
  return next as ObjectTree;
}

/**
 * settings.json を JSONC として扱う（コメントと末尾のカンマを許す）。VS Code が設定ファイルに当てる扱いと同じ。
 * ほかの .json は今までどおり厳密に見る
 */
export function treatAsJsonc(paths: string[]) {
  monaco.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    schemas: [
      {
        uri: "mira://schemas/settings.json",
        // 前に ** を付けないと、file:// で始まる URI と合わない
        fileMatch: paths.map((path) => `**${path}`),
        schema: { type: "object", allowComments: true, allowTrailingCommas: true },
      },
    ],
  });
}

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
