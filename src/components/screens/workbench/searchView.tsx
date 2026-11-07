import { type KeyboardEvent, type RefObject, useEffect, useRef, useState } from "react";
import { useSearchQuery } from "../../../features/search/queries";
import type { SearchFile, SearchMatch, SearchOptions } from "../../../features/search/type";
import { FileIcon } from "./fileIcon";
import { useStoredPreference } from "./storedPreference";

const SEARCH_DELAY_MS = 200;

type Props = {
  rootPath: string;
  isVisible: boolean;
  text: string;
  onTextChange: (text: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onOpenMatch: (path: string, match: SearchMatch, options: { pin: boolean }) => void;
};

/** 一覧に並んでいる行。キーで上下に動くときの順番になる */
type Row = { key: string; file: SearchFile; match: SearchMatch | null };

const fileKey = (file: SearchFile) => `file:${file.path}`;
const matchKey = (file: SearchFile, match: SearchMatch) => `match:${file.path}:${match.line}:${match.column}`;

function summary(files: SearchFile[], isTruncated: boolean): string {
  const count = files.reduce((total, file) => total + file.matches.length, 0);
  if (count === 0) return "No results found.";
  const results = `${count}${isTruncated ? "+" : ""} result${count > 1 ? "s" : ""}`;
  return `${results} in ${files.length} file${files.length > 1 ? "s" : ""}`;
}

export function SearchView({ rootPath, isVisible, text, onTextChange, inputRef, onOpenMatch }: Props) {
  const [query, setQuery] = useState(text);
  const [matchCase, setMatchCase] = useStoredPreference("mira.search.matchCase", false);
  const [useRegex, setUseRegex] = useStoredPreference("mira.search.useRegex", false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const options: SearchOptions = { matchCase, useRegex };
  const { data, error } = useSearchQuery(rootPath, query, options, isVisible);
  // 読めない正規表現のときだけ、Rust から説明の文字列が返る
  const patternError = typeof error === "string" ? error : null;

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const rows: Row[] =
    query === ""
      ? []
      : (data?.files.flatMap((file) => [
          { key: fileKey(file), file, match: null },
          ...(collapsed.has(file.path) ? [] : file.matches.map((match) => ({ key: matchKey(file, match), file, match }))),
        ]) ?? []);
  const selectedIndex = rows.findIndex((row) => row.key === selectedKey);

  useEffect(() => {
    if (selectedKey === null) return;
    resultsRef.current
      ?.querySelector(`[data-key="${CSS.escape(selectedKey)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  const setExpansion = (path: string, isOpen: boolean) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (isOpen) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const relativeFolder = (path: string) =>
    path.slice(rootPath.length + 1, path.lastIndexOf("/") + 1).replace(/\/$/, "");

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // ⌥ を押すと key が別の文字になるので、物理キーで見る
    if (event.metaKey && event.altKey && event.code === "KeyC") setMatchCase((value) => !value);
    else if (event.metaKey && event.altKey && event.code === "KeyR") setUseRegex((value) => !value);
    else if (event.key === "ArrowDown" && rows.length > 0) {
      if (selectedIndex === -1) setSelectedKey(rows[0].key);
      resultsRef.current?.focus();
    } else return;
    event.preventDefault();
  };

  // VS Code と同じ: Enter と ⌘↓ はタブに固定して開き、Space はフォーカスを残したまま中身を見る
  const handleResultsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = rows[selectedIndex];
    const open = (pin: boolean) => {
      if (!current) return;
      if (current.match) onOpenMatch(current.file.path, current.match, { pin });
      else setExpansion(current.file.path, collapsed.has(current.file.path));
    };

    if (event.metaKey && event.key === "ArrowDown") {
      open(true);
      event.preventDefault();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    switch (event.key) {
      case "ArrowDown":
        setSelectedKey((rows[selectedIndex + 1] ?? rows[0])?.key ?? null);
        break;
      case "ArrowUp":
        if (selectedIndex <= 0) inputRef.current?.focus();
        else setSelectedKey(rows[selectedIndex - 1].key);
        break;
      case "ArrowRight":
        if (current && !current.match) {
          if (collapsed.has(current.file.path)) setExpansion(current.file.path, true);
          else if (rows[selectedIndex + 1]) setSelectedKey(rows[selectedIndex + 1].key);
        }
        break;
      case "ArrowLeft":
        if (current?.match) setSelectedKey(fileKey(current.file));
        else if (current) setExpansion(current.file.path, false);
        break;
      case "Enter":
        open(true);
        break;
      case " ":
        open(false);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const toggle = (title: string, icon: string, isOn: boolean, onToggle: () => void) => (
    <button
      type="button"
      className="wb-search-toggle"
      title={title}
      aria-pressed={isOn}
      // 押してもフォーカスを入力欄に残す
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggle}
    >
      <i className={`codicon codicon-${icon}`} />
    </button>
  );

  return (
    <div className="wb-search">
      <div className="wb-search-box">
        <input
          ref={inputRef}
          className="wb-search-input"
          type="text"
          value={text}
          placeholder="Search"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          aria-invalid={patternError !== null}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={handleInputKeyDown}
        />
        <div className="wb-search-toggles">
          {toggle("Match Case (⌥⌘C)", "case-sensitive", matchCase, () => setMatchCase(!matchCase))}
          {toggle("Use Regular Expression (⌥⌘R)", "regex", useRegex, () => setUseRegex(!useRegex))}
        </div>
      </div>
      {error ? (
        <div className="wb-search-summary">{patternError ?? "Unable to search this folder."}</div>
      ) : (
        query !== "" && data && <div className="wb-search-summary">{summary(data.files, data.isTruncated)}</div>
      )}
      {query !== "" && !error && (
        <div
          ref={resultsRef}
          className="wb-search-results"
          role="tree"
          aria-label="Search Results"
          tabIndex={0}
          onKeyDown={handleResultsKeyDown}
        >
          {rows.map(({ key, file, match }) => {
            if (!match) {
              const name = file.path.slice(file.path.lastIndexOf("/") + 1);
              const isOpen = !collapsed.has(file.path);
              return (
                <div
                  key={key}
                  data-key={key}
                  className="wb-search-file"
                  role="treeitem"
                  aria-expanded={isOpen}
                  aria-selected={key === selectedKey}
                  title={file.path}
                  onClick={() => {
                    setSelectedKey(key);
                    setExpansion(file.path, !isOpen);
                  }}
                >
                  <i className={`wb-twistie codicon codicon-chevron-${isOpen ? "down" : "right"}`} />
                  <FileIcon name={name} />
                  <span className="wb-search-file-name">{name}</span>
                  <span className="wb-search-file-folder">{relativeFolder(file.path)}</span>
                  <span className="wb-search-file-count">{file.matches.length}</span>
                </div>
              );
            }
            return (
              <div
                key={key}
                data-key={key}
                className="wb-search-match"
                role="treeitem"
                aria-selected={key === selectedKey}
                title={`Line ${match.line}`}
                onClick={() => {
                  setSelectedKey(key);
                  onOpenMatch(file.path, match, { pin: false });
                }}
                onDoubleClick={() => onOpenMatch(file.path, match, { pin: true })}
              >
                {match.preview.slice(0, match.previewColumn)}
                <mark>{match.preview.slice(match.previewColumn, match.previewColumn + match.length)}</mark>
                {match.preview.slice(match.previewColumn + match.length)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
