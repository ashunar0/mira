import { type MouseEvent, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { renderMarkdown } from "../../../infrastructure/markdown";
import { colorizeCodeBlocks } from "../../../infrastructure/monaco/colorizeCodeBlocks";
import { monaco } from "../../../infrastructure/monaco/setup";
import { openExternalUrl } from "../../../infrastructure/nativeShell";

const EXTERNAL_URL = /^(https?:|mailto:|tel:)/;

type Props = {
  /** タブと共有のモデル。AI が書き換えると、プレビューも追従する */
  model: monaco.editor.ITextModel;
  editorRef: RefObject<monaco.editor.IStandaloneCodeEditor | null>;
  /** 画面の一番上にあるブロックのソース行を返す関数。エディタへ戻るときに使う */
  topLineRef: RefObject<(() => number) | null>;
  /** ダブルクリックしたブロックのソース行を受け取る */
  onEditLine: (line: number) => void;
};

/** エディタは隠れていて高さが 0 のことがあるので、折り返しなしの前提でスクロール量から求める */
function editorTopLine(editor: monaco.editor.IStandaloneCodeEditor): number {
  const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
  return Math.floor(editor.getScrollTop() / lineHeight) + 1;
}

function sourceBlocks(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-line]")];
}

export function MarkdownPreview({ model, editorRef, topLineRef, onEditLine }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const subscribe = useCallback(
    (onChange: () => void) => {
      const subscription = model.onDidChangeContent(onChange);
      return () => subscription.dispose();
    },
    [model],
  );
  const source = useSyncExternalStore(subscribe, () => model.getValue());
  const path = model.uri.path;
  const html = useMemo(() => renderMarkdown(source, path), [source, path]);

  // React が HTML を差し替えるたびに塗り直す
  useEffect(() => {
    const container = containerRef.current;
    if (container && html) return colorizeCodeBlocks(container);
  }, [html]);

  useEffect(() => {
    topLineRef.current = () => {
      const container = containerRef.current;
      if (!container || container.scrollTop === 0) return 1;
      const top = container.getBoundingClientRect().top;
      const block = sourceBlocks(container).find((element) => element.getBoundingClientRect().bottom > top);
      return Number(block?.dataset.line ?? 1);
    };
    return () => {
      topLineRef.current = null;
    };
  }, [topLineRef]);

  // 開いたときは、エディタで見ていた場所から読み始める
  useLayoutEffect(() => {
    const container = containerRef.current;
    const editor = editorRef.current;
    if (!container || !editor) return;
    const line = editorTopLine(editor);
    const block = sourceBlocks(container).find((element) => Number(element.dataset.line) >= line);
    if (line > 1 && block) {
      container.scrollTop += block.getBoundingClientRect().top - container.getBoundingClientRect().top;
    }
  }, [editorRef, model]);

  useEffect(() => {
    if (document.activeElement === document.body) containerRef.current?.focus();
  }, []);

  const handleClick = (event: MouseEvent) => {
    const link = (event.target as Element).closest("a");
    if (!link) return;
    // アプリの画面ごと遷移してしまわないよう、自分では開かない
    event.preventDefault();
    const href = link.getAttribute("href") ?? "";
    if (EXTERNAL_URL.test(href)) void openExternalUrl(href);
  };

  const handleDoubleClick = (event: MouseEvent) => {
    const block = (event.target as Element).closest<HTMLElement>("[data-line]");
    if (block) onEditLine(Number(block.dataset.line));
  };

  return (
    <div
      ref={containerRef}
      className="wb-editor wb-markdown"
      tabIndex={-1}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {/* renderMarkdown は生の HTML をエスケープする */}
      <article className="wb-markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
