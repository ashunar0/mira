import type { monaco } from "./setup";

// VS Code の保存時の掃除（src/vs/workbench/contrib/codeEditor/browser/saveParticipants.ts）と同じもの。
// 手で保存したときの動きだけ（自動保存のときにカーソルの行を残す分は、Mira に自動保存がないので要らない）。
// どれも 1 回の操作として当て、元に戻すで戻れる

function apply(model: monaco.editor.ITextModel, edits: monaco.editor.IIdentifiedSingleEditOperation[]): void {
  if (edits.length === 0) return;
  model.pushStackElement();
  model.pushEditOperations([], edits, () => null);
  model.pushStackElement();
}

const isBlank = (text: string) => /^[ \t]*$/.test(text);

/**
 * files.trimTrailingWhitespace。行末のスペースとタブを消す（VS Code の trimTrailingWhitespaceCommand）。
 * VS Code の files.trimTrailingWhitespaceInRegexAndStrings の既定（true、文字列の中でも消す）と同じ
 */
export function trimTrailingWhitespace(model: monaco.editor.ITextModel): void {
  const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
  for (let line = 1; line <= model.getLineCount(); line++) {
    const text = model.getLineContent(line);
    const kept = text.replace(/[ \t]+$/, "");
    if (kept.length === text.length) continue;
    edits.push({ range: { startLineNumber: line, startColumn: kept.length + 1, endLineNumber: line, endColumn: text.length + 1 }, text: null });
  }
  apply(model, edits);
}

/** files.insertFinalNewline。最後の行に中身があれば、改行を 1 つ足す */
export function insertFinalNewline(model: monaco.editor.ITextModel): void {
  const lastLine = model.getLineCount();
  if (isBlank(model.getLineContent(lastLine))) return;
  const column = model.getLineMaxColumn(lastLine);
  apply(model, [{ range: { startLineNumber: lastLine, startColumn: column, endLineNumber: lastLine, endColumn: column }, text: model.getEOL() }]);
}

/** files.trimFinalNewlines。中身のある最後の行より後ろの空行を消す（空白だけの行は、中身のある行として残す） */
export function trimFinalNewlines(model: monaco.editor.ITextModel): void {
  const lineCount = model.getLineCount();
  if (lineCount === 1) return;
  let lastNonEmpty = lineCount;
  while (lastNonEmpty >= 1 && model.getLineLength(lastNonEmpty) === 0) lastNonEmpty--;
  const from = lastNonEmpty + 1;
  if (from > lineCount) return;
  // 1 行目から消すとき（全部が空）は先頭から、そうでなければ中身のある最後の行の終わりの改行の後ろから
  const range = model.validateRange({ startLineNumber: from, startColumn: 1, endLineNumber: lineCount, endColumn: model.getLineMaxColumn(lineCount) });
  if (range.startLineNumber === range.endLineNumber && range.startColumn === range.endColumn) return;
  apply(model, [{ range, text: null }]);
}
