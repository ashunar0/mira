import { shikiToMonaco } from "@shikijs/monaco";
import { createHighlighter } from "shiki";
import { monaco } from "./setup";
import { KANAGAWA_DRAGON } from "./theme";

/**
 * Monaco にない言語。VS Code と同じく .tsx と .jsx は .ts と .js と別の文法で色を付けるので、別の言語にする
 * （Monaco はどちらも typescript / javascript として扱う）
 */
const EXTRA_LANGUAGES: monaco.languages.ILanguageExtensionPoint[] = [
  { id: "tsx", extensions: [".tsx"], aliases: ["TypeScript JSX", "tsx"] },
  { id: "jsx", extensions: [".jsx"], aliases: ["JavaScript JSX", "jsx"] },
  { id: "toml", extensions: [".toml"], aliases: ["TOML", "toml"] },
  { id: "astro", extensions: [".astro"], aliases: ["Astro", "astro"] },
];

/** 色を付ける言語。名前は Monaco の言語の ID と同じにする（Shiki の別名でもよい） */
const LANGUAGES = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "css",
  "scss",
  "less",
  "html",
  "markdown",
  "astro",
  "rust",
  "toml",
  "yaml",
  "shell",
  "python",
  "go",
  "sql",
  "dockerfile",
  "ini",
  "xml",
];

/**
 * コードの色を、Monaco の簡易的な仕組み（Monarch）から、VS Code と同じ TextMate 文法に替える。
 * テーマの tokenColors もそのまま効く。エディタを作る前に済ませる
 */
export async function installSyntaxHighlighting(): Promise<void> {
  for (const language of EXTRA_LANGUAGES) monaco.languages.register(language);
  const highlighter = await createHighlighter({ themes: [KANAGAWA_DRAGON], langs: LANGUAGES });
  shikiToMonaco(highlighter, monaco);
}
