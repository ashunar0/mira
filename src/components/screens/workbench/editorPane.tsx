import { useEffect, useRef } from "react";
import { EDITOR_OPTIONS, monaco } from "../../../infrastructure/monaco/setup";
import type { EditorStatus } from "./statusBar";

type Props = {
  model: monaco.editor.ITextModel | null;
  focusRequest: number;
  onStatusChange: (status: EditorStatus | null) => void;
};

function readStatus(editor: monaco.editor.IStandaloneCodeEditor): EditorStatus | null {
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

export function EditorPane({ model, focusRequest, onStatusChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  // タブを行き来してもカーソルとスクロール位置を保つ。モデルが捨てられたら一緒に消える
  const viewStates = useRef(new WeakMap<monaco.editor.ITextModel, monaco.editor.ICodeEditorViewState>());

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
  }, [onStatusChange]);

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
  }, [model, onStatusChange]);

  useEffect(() => {
    if (focusRequest > 0) editorRef.current?.focus();
  }, [focusRequest]);

  return <div ref={containerRef} className="wb-editor" hidden={!model} />;
}
