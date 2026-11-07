import { convertFileSrc } from "@tauri-apps/api/core";
import MarkdownIt from "markdown-it";

/** 先頭のフロントマター（Astro などのメタデータ）。本文ではないので表示しない */
const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
/** フロントマターの中で、見出しとして出す値。値を囲む引用符は外す */
const TITLE = /^title:[ \t]*(["']?)(.*?)\1[ \t]*$/;
/** https: や data: など、ファイルのパスではない画像の指定 */
const URL_WITH_SCHEME = /^[a-z][a-z\d+.-]*:/i;

type Env = {
  lineOffset: number;
  /** 開いている Markdown ファイルのあるフォルダ。画像の相対パスはここから辿る */
  baseDir: string;
};

// 生の HTML はエスケープされたままにする。開いたファイルに書かれたスクリプトを動かさないため
const renderer = new MarkdownIt({ html: false, linkify: true });

// プレビューからソースの位置へ戻れるよう、ブロックに行番号（1 始まり）をつける
renderer.core.ruler.push("source_line", (state) => {
  for (const token of state.tokens) {
    if (token.map && token.nesting >= 0 && token.type !== "inline") {
      token.attrSet("data-line", String(token.map[0] + 1 + (state.env as Env).lineOffset));
    }
  }
});

/** . と .. をたどった絶対パスにする */
function normalize(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "..") segments.pop();
    else if (segment !== "." && segment !== "") segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

/** 相対パスの画像だけを、アプリから読める URL に置き換える。/ で始まるものは置き場所が分からないので触らない */
function resolveImageSrc(src: string, baseDir: string): string {
  if (URL_WITH_SCHEME.test(src) || src.startsWith("/") || src.startsWith("#")) return src;
  const path = src.replace(/[?#].*$/, "");
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // % がそのままファイル名に入っている
  }
  return convertFileSrc(normalize(`${baseDir}/${decoded}`));
}

const renderImage = renderer.renderer.rules.image;
renderer.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const src = token.attrGet("src");
  if (typeof src === "string" && src !== "") token.attrSet("src", resolveImageSrc(src, (env as Env).baseDir));
  return renderImage ? renderImage(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
};

/** フロントマターの title を、行番号つきの見出しにする */
function renderTitle(frontMatter: string): string {
  const lines = frontMatter.split(/\r?\n/);
  const index = lines.findIndex((line) => TITLE.test(line));
  const title = index === -1 ? "" : (TITLE.exec(lines[index])?.[2] ?? "");
  if (title === "") return "";
  return `<h1 data-line="${index + 1}">${renderer.utils.escapeHtml(title)}</h1>\n`;
}

export function renderMarkdown(source: string, filePath: string): string {
  const frontMatter = FRONT_MATTER.exec(source)?.[0] ?? "";
  const env: Env = {
    lineOffset: frontMatter.split("\n").length - 1,
    baseDir: filePath.slice(0, filePath.lastIndexOf("/")),
  };
  return renderTitle(frontMatter) + renderer.render(source.slice(frontMatter.length), env);
}
