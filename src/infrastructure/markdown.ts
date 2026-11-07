import MarkdownIt from "markdown-it";

/** 先頭のフロントマター（Astro などのメタデータ）。本文ではないので表示しない */
const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

// 生の HTML はエスケープされたままにする。開いたファイルに書かれたスクリプトを動かさないため
const renderer = new MarkdownIt({ html: false, linkify: true });

// プレビューからソースの位置へ戻れるよう、ブロックに行番号（1 始まり）をつける
renderer.core.ruler.push("source_line", (state) => {
  for (const token of state.tokens) {
    if (token.map && token.nesting >= 0 && token.type !== "inline") {
      token.attrSet("data-line", String(token.map[0] + 1 + (state.env as { lineOffset: number }).lineOffset));
    }
  }
});

export function renderMarkdown(source: string): string {
  const frontMatter = FRONT_MATTER.exec(source)?.[0] ?? "";
  const lineOffset = frontMatter.split("\n").length - 1;
  return renderer.render(source.slice(frontMatter.length), { lineOffset });
}
