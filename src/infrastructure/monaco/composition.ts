import "./composition.css";
import type { monaco } from "./setup";

/**
 * 日本語などの変換中の見た目を VS Code に揃える。
 *
 * VS Code（Chromium）は EditContext で入力を受け、変換中の文字を行の中に描いて下線を引く。Mira（WebKit）には
 * EditContext がないので、Monaco は隠れた入力欄（textarea）で受け、変換中はその入力欄を行の上に重ねて見せる。
 * WebKit はそこに変換中の文字を自分の描き方で描くので、背景に色が付き、VS Code と見た目が変わる。
 * 変換中の文字は行そのものにも入っているので、入力欄を見えなくし、行の文字に VS Code と同じ下線を引く。
 * 文節の区切り（VS Code の太い下線）は、WebKit がページに教えないので出せない
 */
export function matchCompositionToVSCode(editor: monaco.editor.ICodeEditor): monaco.IDisposable {
  const underline = editor.createDecorationsCollection();
  let start: monaco.IPosition | null = null;

  const update = () => {
    const position = editor.getPosition();
    if (!start || !position || position.lineNumber !== start.lineNumber || position.column <= start.column) {
      underline.clear();
      return;
    }
    underline.set([
      {
        range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: position.lineNumber, endColumn: position.column },
        options: { inlineClassName: "mira-composition" },
      },
    ]);
  };

  const subscriptions = [
    editor.onDidCompositionStart(() => {
      start = editor.getPosition();
      editor.getDomNode()?.classList.add("mira-composing");
    }),
    editor.onDidChangeCursorPosition(() => {
      if (start) update();
    }),
    editor.onDidCompositionEnd(() => {
      start = null;
      underline.clear();
      editor.getDomNode()?.classList.remove("mira-composing");
    }),
  ];
  return {
    dispose: () => {
      for (const subscription of subscriptions) subscription.dispose();
      underline.clear();
    },
  };
}
