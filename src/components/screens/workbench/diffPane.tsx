import { type RefObject, useEffect, useRef } from "react";
import { editorSettingsFor } from "../../../features/settings/lib/settings";
import { useSettingsQuery } from "../../../features/settings/queries";
import { matchCompositionToVSCode } from "../../../infrastructure/monaco/composition";
import type { ObjectTree } from "../../../infrastructure/objectTree";
import {
  DIFF_EDITOR_OPTIONS,
  diffEditorOptions,
  disposeDiffEditor,
  monaco,
  replaceOptions,
} from "../../../infrastructure/monaco/setup";
import { readStatus } from "./editorPane";
import type { EditorStatus } from "./statusBar";

// VS Code の diff エディタの、スクロールバーの印と同じ色（テーマで変わる）
const ADDED_MARK_COLOR = { id: "diffEditorOverview.insertedForeground" };
const REMOVED_MARK_COLOR = { id: "diffEditorOverview.removedForeground" };

type Props = {
  /** 右側に出す、タブと共有のモデル。ここで編集すればタブの内容も変わる */
  model: monaco.editor.ITextModel;
  /** 左側に出す内容 */
  originalText: string;
  focusRequest: number;
  editorRef: RefObject<monaco.editor.IStandaloneDiffEditor | null>;
  onStatusChange: (status: EditorStatus | null) => void;
};

/** スクロールバーに出す印。行が残っていれば緑、削除だけなら削除された位置に赤 */
function toScrollbarMarks(changes: monaco.editor.ILineChange[]): monaco.editor.IModelDeltaDecoration[] {
  return changes.map((change) => {
    const isRemovalOnly = change.modifiedEndLineNumber === 0;
    const startLine = Math.max(change.modifiedStartLineNumber, 1);
    return {
      range: new monaco.Range(startLine, 1, isRemovalOnly ? startLine : change.modifiedEndLineNumber, 1),
      options: {
        overviewRuler: {
          color: isRemovalOnly ? REMOVED_MARK_COLOR : ADDED_MARK_COLOR,
          position: monaco.editor.OverviewRulerLane.Full,
        },
      },
    };
  });
}

export function DiffPane({ model, originalText, focusRequest, editorRef, onStatusChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const diffEditor = monaco.editor.createDiffEditor(containerRef.current!, DIFF_EDITOR_OPTIONS);
    const modified = diffEditor.getModifiedEditor();
    // Monaco は左側にだけアイコン用の余白をつけるので、消して行番号の位置を普段のエディタと揃える
    diffEditor.getOriginalEditor().updateOptions({ glyphMargin: false });
    editorRef.current = diffEditor;
    const report = () => onStatusChange(readStatus(modified));
    const subscriptions = [
      modified.onDidChangeCursorSelection(report),
      modified.onDidChangeModel(report),
      modified.onDidChangeModelContent(report),
      matchCompositionToVSCode(modified),
    ];
    return () => {
      subscriptions.forEach((subscription) => subscription.dispose());
      disposeDiffEditor(diffEditor);
      editorRef.current = null;
    };
  }, [editorRef, onStatusChange]);

  useEffect(() => {
    const diffEditor = editorRef.current!;
    const original = monaco.editor.createModel(originalText, model.getLanguageId());
    diffEditor.setModel({ original, modified: model });

    const marks = diffEditor.getModifiedEditor().createDecorationsCollection();
    let hasRevealed = false;
    const subscription = diffEditor.onDidUpdateDiff(() => {
      marks.set(toScrollbarMarks(diffEditor.getLineChanges() ?? []));
      // 長いファイルでも、開いてすぐ最初の変更が見えるようにする。編集のたびには動かさない
      if (!hasRevealed) {
        hasRevealed = true;
        diffEditor.revealFirstDiff();
      }
    });
    return () => {
      subscription.dispose();
      // 画面を閉じるときは、上の effect が先に diff エディタを捨てている
      if (editorRef.current === diffEditor) {
        marks.clear();
        diffEditor.setModel(null);
      }
      original.dispose();
    };
  }, [editorRef, model, originalText]);

  const settings = useSettingsQuery();
  const appliedOptions = useRef<ObjectTree>({});
  useEffect(() => {
    const next = diffEditorOptions(editorSettingsFor(settings, model.getLanguageId()));
    appliedOptions.current = replaceOptions(editorRef.current!, appliedOptions.current, next);
  }, [editorRef, model, settings]);

  // 普段のエディタでは同じキーを複数カーソルに使うので、ネイティブメニューには置かず diff の間だけ受け取る
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || !event.altKey) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      event.stopPropagation();
      editorRef.current?.goToDiff(event.key === "ArrowDown" ? "next" : "previous");
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [editorRef]);

  useEffect(() => {
    // Explorer を矢印キーで移動中に、フォーカスを奪わない
    if (document.activeElement === document.body) editorRef.current?.getModifiedEditor().focus();
  }, [editorRef, focusRequest]);

  return <div ref={containerRef} className="wb-editor" />;
}
