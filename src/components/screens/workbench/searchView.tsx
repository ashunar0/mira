import { type RefObject, useEffect, useState } from "react";
import { useSearchQuery } from "../../../features/search/queries";
import type { SearchFile, SearchMatch } from "../../../features/search/type";
import { FileIcon } from "./fileIcon";

const SEARCH_DELAY_MS = 200;

type Props = {
  rootPath: string;
  isVisible: boolean;
  text: string;
  onTextChange: (text: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onOpenMatch: (path: string, match: SearchMatch, options: { pin: boolean }) => void;
};

function summary(files: SearchFile[], isTruncated: boolean): string {
  const count = files.reduce((total, file) => total + file.matches.length, 0);
  if (count === 0) return "No results found.";
  const results = `${count}${isTruncated ? "+" : ""} result${count > 1 ? "s" : ""}`;
  return `${results} in ${files.length} file${files.length > 1 ? "s" : ""}`;
}

export function SearchView({ rootPath, isVisible, text, onTextChange, inputRef, onOpenMatch }: Props) {
  const [query, setQuery] = useState(text);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const { data, error } = useSearchQuery(rootPath, query, isVisible);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const toggleFile = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const relativeFolder = (path: string) =>
    path.slice(rootPath.length + 1, path.lastIndexOf("/") + 1).replace(/\/$/, "");

  return (
    <div className="wb-search">
      <input
        ref={inputRef}
        className="wb-search-input"
        type="text"
        value={text}
        placeholder="Search"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        onChange={(event) => onTextChange(event.target.value)}
      />
      {error ? (
        <div className="wb-search-summary">Unable to search this folder.</div>
      ) : (
        query !== "" && data && <div className="wb-search-summary">{summary(data.files, data.isTruncated)}</div>
      )}
      {query !== "" && (
        <div className="wb-search-results">
          {data?.files.map((file) => {
            const name = file.path.slice(file.path.lastIndexOf("/") + 1);
            const isOpen = !collapsed.has(file.path);
            return (
              <div key={file.path} role="none">
                <div className="wb-search-file" title={file.path} onClick={() => toggleFile(file.path)}>
                  <i className={`wb-twistie codicon codicon-chevron-${isOpen ? "down" : "right"}`} />
                  <FileIcon name={name} />
                  <span className="wb-search-file-name">{name}</span>
                  <span className="wb-search-file-folder">{relativeFolder(file.path)}</span>
                  <span className="wb-search-file-count">{file.matches.length}</span>
                </div>
                {isOpen &&
                  file.matches.map((match) => (
                    <div
                      key={`${match.line}:${match.column}`}
                      className="wb-search-match"
                      title={`Line ${match.line}`}
                      onClick={() => onOpenMatch(file.path, match, { pin: false })}
                      onDoubleClick={() => onOpenMatch(file.path, match, { pin: true })}
                    >
                      {match.preview.slice(0, match.previewColumn)}
                      <mark>{match.preview.slice(match.previewColumn, match.previewColumn + match.length)}</mark>
                      {match.preview.slice(match.previewColumn + match.length)}
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
