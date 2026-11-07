import { editor, Range } from "monaco-editor";

function majorityEndOfLine(text: string): "\n" | "\r\n" {
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  const lf = (text.match(/\n/g)?.length ?? 0) - crlf;
  return crlf > lf ? "\r\n" : "\n";
}

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * モデルの内容を text に置き換える。setValue と違い、変わった範囲だけを編集するので
 * カーソルやスクロール位置が保たれ、undo でも戻せる。
 */
export function replaceModelText(model: editor.ITextModel, text: string) {
  const endOfLine = majorityEndOfLine(text);
  model.pushStackElement();
  if (model.getEOL() !== endOfLine) {
    model.pushEOL(endOfLine === "\n" ? editor.EndOfLineSequence.LF : editor.EndOfLineSequence.CRLF);
  }

  const current = model.getValue();
  const next = text.replace(/\r\n|\r|\n/g, endOfLine);
  if (current !== next) {
    const shorter = Math.min(current.length, next.length);
    let prefix = 0;
    while (prefix < shorter && current[prefix] === next[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < shorter - prefix &&
      current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
    ) {
      suffix++;
    }
    // サロゲートペア（絵文字など）や改行の途中で切らないよう、境界を外側へ寄せる
    const splitsPair = (value: string, index: number) =>
      index > 0 && index < value.length && (isLowSurrogate(value.charCodeAt(index)) || (value[index - 1] === "\r" && value[index] === "\n"));
    while (prefix > 0 && (splitsPair(current, prefix) || splitsPair(next, prefix))) prefix--;
    while (
      suffix > 0 &&
      (splitsPair(current, current.length - suffix) || splitsPair(next, next.length - suffix))
    ) {
      suffix--;
    }

    const start = model.getPositionAt(prefix);
    const end = model.getPositionAt(current.length - suffix);
    model.pushEditOperations(
      [],
      [
        {
          range: new Range(start.lineNumber, start.column, end.lineNumber, end.column),
          text: next.slice(prefix, next.length - suffix),
        },
      ],
      () => null,
    );
  }
  model.pushStackElement();
}
