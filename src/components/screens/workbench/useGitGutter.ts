import { type RefObject, useEffect } from "react";
import { DIFF_EDITOR_OPTIONS, disposeDiffEditor, monaco } from "../../../infrastructure/monaco/setup";

function gutterClass(change: monaco.editor.ILineChange): string {
  if (change.modifiedEndLineNumber === 0) return "wb-gutter-removed";
  return change.originalEndLineNumber === 0 ? "wb-gutter-added" : "wb-gutter-modified";
}

function toGutterMarks(changes: monaco.editor.ILineChange[]): monaco.editor.IModelDeltaDecoration[] {
  return changes.map((change) => {
    const startLine = Math.max(change.modifiedStartLineNumber, 1);
    return {
      range: new monaco.Range(startLine, 1, Math.max(change.modifiedEndLineNumber, startLine), 1),
      options: { linesDecorationsClassName: gutterClass(change) },
    };
  });
}

/**
 * 行番号の右に、originalText から変わった行の印を出す。null なら出さない。
 * 差分の計算を公開している API がないので、画面に置かない diff エディタに計算させる。
 * 編集のたびに計算し直してくれるので、未保存の変更にも追従する。
 */
export function useGitGutter(
  editorRef: RefObject<monaco.editor.IStandaloneCodeEditor | null>,
  model: monaco.editor.ITextModel | null,
  originalText: string | null,
) {
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !model || originalText === null) return;

    const original = monaco.editor.createModel(originalText, "plaintext");
    const differ = monaco.editor.createDiffEditor(document.createElement("div"), {
      ...DIFF_EDITOR_OPTIONS,
      automaticLayout: false,
    });
    differ.setModel({ original, modified: model });

    const marks = editor.createDecorationsCollection();
    const subscription = differ.onDidUpdateDiff(() => marks.set(toGutterMarks(differ.getLineChanges() ?? [])));
    return () => {
      subscription.dispose();
      // 画面を閉じるときは、エディタが先に捨てられている
      if (editorRef.current === editor) marks.clear();
      differ.setModel(null);
      disposeDiffEditor(differ);
      original.dispose();
    };
  }, [editorRef, model, originalText]);
}
