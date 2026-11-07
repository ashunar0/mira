import * as monaco from "monaco-editor";

/** ```ts の ts のような名前を Monaco の言語に読み替える。id、別名、拡張子の順に探す */
function findLanguage(name: string): string | null {
  const wanted = name.toLowerCase();
  const languages = monaco.languages.getLanguages();
  const found =
    languages.find((language) => language.id === wanted) ??
    languages.find((language) => language.aliases?.some((alias) => alias.toLowerCase() === wanted)) ??
    languages.find((language) => language.extensions?.includes(`.${wanted}`));
  return found?.id ?? null;
}

/**
 * markdown-it が出した <code class="language-xxx"> を、エディタと同じ色で塗る。
 * 塗り終わる前に中身が変わったら、返した関数で取りやめる。
 */
export function colorizeCodeBlocks(container: HTMLElement): () => void {
  let isCancelled = false;
  for (const code of container.querySelectorAll<HTMLElement>("pre > code[class*='language-']")) {
    const name = /language-(\S+)/.exec(code.className)?.[1];
    const language = name ? findLanguage(name) : null;
    if (!language) continue;
    // 最後の改行まで塗ると、末尾に空の行が 1 つ増える
    const text = (code.textContent ?? "").replace(/\n$/, "");
    void monaco.editor.colorize(text, language, { tabSize: 4 }).then((html) => {
      if (!isCancelled) code.innerHTML = html;
    });
  }
  return () => {
    isCancelled = true;
  };
}
