import { shikiToMonaco } from "@shikijs/monaco";
import { type BundledLanguage, bundledLanguages, createHighlighter, type Highlighter, type ThemeRegistrationRaw } from "shiki";
import { monaco } from "./setup";

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

// shikiToMonaco は Monaco の setTheme と create を包む。テーマを替えるたびに呼び直すので、包み直す前に元へ戻す
const originalSetTheme = monaco.editor.setTheme;
const originalCreate = monaco.editor.create;

let highlighter: Highlighter | null = null;
let themeCount = 0;
let currentTheme: string | null = null;

/** 文法やテーマを足した後に、Monaco に色の付け方を渡し直す */
function reinstall(): void {
  if (!highlighter) return;
  monaco.editor.setTheme = originalSetTheme;
  monaco.editor.create = originalCreate;
  shikiToMonaco(highlighter, monaco);
  if (currentTheme) monaco.editor.setTheme(currentTheme);
}

/**
 * コードの色を、Monaco の簡易的な仕組み（Monarch）から、VS Code と同じ TextMate 文法に替える。
 * テーマの tokenColors もそのまま効く。エディタを作る前に済ませる
 */
export async function installSyntaxHighlighting(): Promise<void> {
  for (const language of EXTRA_LANGUAGES) monaco.languages.register(language);
  highlighter = await createHighlighter({ themes: [], langs: LANGUAGES });
}

/**
 * コードの色とエディタの色を、このテーマに替える。installSyntaxHighlighting の前に呼ばれたら（色の仕組みを
 * 替えられなかったとき）、エディタの色だけ替える
 */
export function switchCodeTheme(theme: Omit<ThemeRegistrationRaw, "name">): void {
  // 中身が変わっても確実に作り直されるよう、毎回別の名前にする
  const name = `mira-theme-${++themeCount}`;
  currentTheme = name;
  const registration = { ...theme, name } as ThemeRegistrationRaw;
  if (!highlighter) {
    monaco.editor.defineTheme(name, {
      base: theme.type === "light" ? "vs" : "vs-dark",
      inherit: true,
      rules: [],
      colors: (theme.colors ?? {}) as Record<string, string>,
    });
    monaco.editor.setTheme(name);
    return;
  }
  highlighter.loadThemeSync(registration);
  reinstall();
}

/**
 * 拡張子ごとの言語を Monaco に登録し、その Monaco の言語を返す。Monaco が知っている拡張子はそのまま使う。
 * 知らない拡張子は languageIds の名前で登録し、Shiki に同じ名前の文法があれば色も付ける（vue、svelte など）。
 * 登録前に開いていたファイルは、言語なしで開かれているので付け直す
 */
export async function ensureLanguages(languageIds: Record<string, string>): Promise<string[]> {
  const monacoIds = new Set<string>();
  let addedGrammar = false;
  for (const [extension, languageId] of Object.entries(languageIds)) {
    const known = monaco.languages.getLanguages().find((language) => language.extensions?.includes(`.${extension}`));
    if (known) {
      monacoIds.add(known.id);
      continue;
    }
    monaco.languages.register({ id: languageId, extensions: [`.${extension}`] });
    monacoIds.add(languageId);
    if (highlighter && languageId in bundledLanguages && !highlighter.getLoadedLanguages().includes(languageId)) {
      await highlighter.loadLanguage(languageId as BundledLanguage);
      addedGrammar = true;
    }
    for (const model of monaco.editor.getModels()) {
      if (model.uri.path.endsWith(`.${extension}`) && model.getLanguageId() === "plaintext") {
        monaco.editor.setModelLanguage(model, languageId);
      }
    }
  }
  if (addedGrammar) reinstall();
  return [...monacoIds];
}
