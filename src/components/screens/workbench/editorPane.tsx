import { type RefObject, useEffect, useRef } from "react";
import { EDITOR_OPTIONS, monaco } from "../../../infrastructure/monaco/setup";
import type { EditorStatus } from "./statusBar";
import { useGitGutter } from "./useGitGutter";

type Props = {
  model: monaco.editor.ITextModel | null;
  /** diff の表示中は隠す。隠れたエディタに文字が入らないよう、フォーカスも外れる */
  isHidden: boolean;
  /** 行番号の右の印を、この内容と比べて出す。null なら出さない */
  gutterBaseText: string | null;
  focusRequest: number;
  editorRef: RefObject<monaco.editor.IStandaloneCodeEditor | null>;
  viewStates: RefObject<WeakMap<monaco.editor.ITextModel, monaco.editor.ICodeEditorViewState>>;
  onStatusChange: (status: EditorStatus | null) => void;
};

export function readStatus(editor: monaco.editor.ICodeEditor): EditorStatus | null {
  const model = editor.getModel();
  const position = editor.getPosition();
  if (!model || !position) return null;
  const { tabSize, insertSpaces } = model.getOptions();
  const selectedChars = (editor.getSelections() ?? []).reduce(
    (total, selection) => total + model.getValueLengthInRange(selection),
    0,
  );
  const languageId = model.getLanguageId();
  const language = monaco.languages.getLanguages().find((l) => l.id === languageId);
  return {
    line: position.lineNumber,
    column: position.column,
    selectedChars,
    tabSize,
    insertSpaces,
    endOfLine: model.getEOL() === "\n" ? "LF" : "CRLF",
    languageName: language?.aliases?.[0] ?? languageId,
  };
}

export function EditorPane({ model, isHidden, gutterBaseText, focusRequest, editorRef, viewStates, onStatusChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const editor = monaco.editor.create(containerRef.current!, EDITOR_OPTIONS);
    editorRef.current = editor;
    const report = () => onStatusChange(readStatus(editor));
    const subscriptions = [
      editor.onDidChangeCursorSelection(report),
      editor.onDidChangeModel(report),
      editor.onDidChangeModelOptions(report),
      editor.onDidChangeModelContent(report),
      editor.onDidChangeModelLanguage(report),
    ];
    return () => {
      subscriptions.forEach((subscription) => subscription.dispose());
      editor.dispose();
      editorRef.current = null;
    };
  }, [editorRef, onStatusChange]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.getModel() === model) return;
    const previous = editor.getModel();
    const previousState = editor.saveViewState();
    if (previous && previousState) viewStates.current.set(previous, previousState);
    editor.setModel(model);
    const nextState = model && viewStates.current.get(model);
    if (nextState) editor.restoreViewState(nextState);
    if (!model) onStatusChange(null);
  }, [editorRef, model, onStatusChange, viewStates]);

  useGitGutter(editorRef, model, gutterBaseText);

  useEffect(() => {
    if (focusRequest > 0) editorRef.current?.focus();
  }, [editorRef, focusRequest]);

  // diff から戻ったら、ステータスバーをこのエディタの内容に戻す
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && !isHidden) onStatusChange(readStatus(editor));
  }, [editorRef, isHidden, onStatusChange]);

  return <div ref={containerRef} className="wb-editor" hidden={!model || isHidden} />;
}
