import { isPlainObject } from "../../../infrastructure/objectTree";

/** Rust に渡す、起動のしかた（src-tauri の lsp.rs の ServerSpec と同じ形） */
export type ServerSpec = "typescript" | "rust" | { custom: { command: string[]; rootMarkers: string[] } };

export type LanguageServerDefinition = {
  /** 設定での名前。型エラーの持ち主の名前にも使う */
  name: string;
  spec: ServerSpec;
  /** 拡張子ごとの、サーバーに伝える言語。ほかのファイルは渡さない */
  languageIds: Record<string, string>;
  /** Monaco の言語。書いていなければ、拡張子から決める（syntaxHighlighting の ensureLanguages） */
  monacoLanguages?: string[];
  /**
   * 外で書き換えられたファイルも、保存したと伝える。rust-analyzer は保存で cargo check を走らせ、
   * 型エラーの多くはその結果で届く。VS Code は Mira の中で保存したときだけ伝えるが、Mira は AI が外で
   * 書き換える前提なので、伝えないと型エラーが古いまま残る
   */
  saveOnExternalChange: boolean;
  initializationOptions?: unknown;
  /** このサーバーが代わりを務める VS Code の拡張機能の ID。editor.defaultFormatter と照らして、整形の担当を決める */
  formatterId: string | null;
};

export const BUILTIN_SERVERS: LanguageServerDefinition[] = [
  {
    name: "typescript",
    spec: "typescript",
    monacoLanguages: ["typescript", "tsx", "javascript", "jsx"],
    languageIds: {
      ts: "typescript",
      mts: "typescript",
      cts: "typescript",
      tsx: "typescriptreact",
      js: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      jsx: "javascriptreact",
    },
    saveOnExternalChange: false,
    formatterId: "vscode.typescript-language-features",
  },
  {
    name: "rust",
    spec: "rust",
    monacoLanguages: ["rust"],
    languageIds: { rs: "rust" },
    saveOnExternalChange: true,
    formatterId: "rust-lang.rust-analyzer",
  },
];

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * 設定の mira.languageServers から。書き方の合わないものは飛ばす。組み込みと同じ名前なら、組み込みの代わりに使う
 *
 *   "vue": { "command": ["vue-language-server", "--stdio"], "languages": { "vue": "vue" },
 *            "root": ["package.json"], "initializationOptions": {}, "formatter": "Vue.volar" }
 */
export function languageServersFrom(value: unknown): LanguageServerDefinition[] {
  const custom: LanguageServerDefinition[] = [];
  if (isPlainObject(value)) {
    for (const [name, entry] of Object.entries(value)) {
      if (!isPlainObject(entry) || !isStringArray(entry.command) || entry.command.length === 0) continue;
      if (!isPlainObject(entry.languages)) continue;
      const languageIds = Object.fromEntries(
        Object.entries(entry.languages)
          .filter((pair): pair is [string, string] => typeof pair[1] === "string")
          .map(([extension, id]) => [extension.replace(/^\./, ""), id]),
      );
      custom.push({
        name,
        spec: { custom: { command: entry.command, rootMarkers: isStringArray(entry.root) ? entry.root : [] } },
        languageIds,
        saveOnExternalChange: false,
        initializationOptions: entry.initializationOptions,
        formatterId: typeof entry.formatter === "string" ? entry.formatter : null,
      });
    }
  }
  const replaced = new Set(custom.map((server) => server.name));
  return [...BUILTIN_SERVERS.filter((server) => !replaced.has(server.name)), ...custom];
}
