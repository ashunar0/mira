import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ancestorsWithin, baseName, parentPath } from "../../../features/files/lib/path";
import { useDirectoryQuery, useRefreshDirectories } from "../../../features/files/queries";
import { ActivityBar } from "./activityBar";
import { FileIcon, FolderIcon } from "./fileIcon";

type Props = {
  rootPath: string | null;
  activePath: string | null;
  onOpenFile: (path: string, options: { pin: boolean }) => void;
  onOpenFolder: () => void;
};

export function Explorer({ rootPath, activePath, onOpenFile, onOpenFolder }: Props) {
  return (
    <aside className="wb-sidebar">
      <ActivityBar />
      <div className="wb-sidebar-title">Explorer</div>
      {rootPath ? (
        <FolderTree
          key={rootPath}
          rootPath={rootPath}
          activePath={activePath}
          onOpenFile={onOpenFile}
          onOpenFolder={onOpenFolder}
        />
      ) : (
        <NoFolder onOpenFolder={onOpenFolder} />
      )}
    </aside>
  );
}

function NoFolder({ onOpenFolder }: { onOpenFolder: () => void }) {
  return (
    <div className="wb-no-folder">
      <p>You have not yet opened a folder.</p>
      <button type="button" className="wb-button" onClick={onOpenFolder}>
        Open Folder
      </button>
    </div>
  );
}

type FolderTreeProps = Props & { rootPath: string };

function FolderTree({ rootPath, activePath, onOpenFile, onOpenFolder }: FolderTreeProps) {
  const [isRootOpen, setIsRootOpen] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const refresh = useRefreshDirectories();

  const setExpansion = (path: string, isOpen: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (isOpen) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  // アクティブなファイルを Explorer に表示する（explorer.autoReveal）
  useEffect(() => {
    if (!activePath || !activePath.startsWith(`${rootPath}/`)) return;
    setSelectedPath(activePath);
    setIsRootOpen(true);
    setExpanded((current) => new Set([...current, ...ancestorsWithin(rootPath, activePath)]));
  }, [activePath, rootPath]);

  const activateRow = (path: string, isDirectory: boolean, pin: boolean) => {
    setSelectedPath(path);
    if (isDirectory) {
      if (!pin) setExpansion(path, !expanded.has(path));
    } else {
      onOpenFile(path, { pin });
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const rows = [...(treeRef.current?.querySelectorAll<HTMLElement>("[data-path]") ?? [])];
    const index = rows.findIndex((row) => row.dataset.path === selectedPath);
    const current = rows[index];
    const select = (row: HTMLElement | undefined) => {
      if (row?.dataset.path) setSelectedPath(row.dataset.path);
    };

    switch (event.key) {
      case "ArrowDown":
        select(rows[index + 1] ?? rows[0]);
        break;
      case "ArrowUp":
        select(rows[index - 1] ?? rows[0]);
        break;
      case "ArrowRight":
        if (current?.dataset.directory === "true") {
          if (expanded.has(current.dataset.path!)) select(rows[index + 1]);
          else setExpansion(current.dataset.path!, true);
        }
        break;
      case "ArrowLeft":
        if (!current) break;
        if (expanded.has(current.dataset.path!)) {
          setExpansion(current.dataset.path!, false);
        } else {
          const parent = parentPath(current.dataset.path!);
          if (parent !== rootPath) setSelectedPath(parent);
        }
        break;
      case "Enter":
      case " ":
        if (current) {
          const isDirectory = current.dataset.directory === "true";
          if (isDirectory) setExpansion(current.dataset.path!, !expanded.has(current.dataset.path!));
          else onOpenFile(current.dataset.path!, { pin: event.key === "Enter" });
        }
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div className="wb-explorer">
      <div className="wb-section-header">
        <button
          type="button"
          className="wb-section-toggle"
          aria-expanded={isRootOpen}
          onClick={() => setIsRootOpen(!isRootOpen)}
        >
          <i className={`codicon codicon-chevron-${isRootOpen ? "down" : "right"}`} />
          <span>{baseName(rootPath)}</span>
        </button>
        <div className="wb-section-actions">
          <button
            type="button"
            className="wb-icon-button"
            title="Open Folder (⌘O)"
            onClick={onOpenFolder}
          >
            <i className="codicon codicon-folder-opened" />
          </button>
          <button
            type="button"
            className="wb-icon-button"
            title="Refresh Explorer"
            onClick={() => void refresh()}
          >
            <i className="codicon codicon-refresh" />
          </button>
          <button
            type="button"
            className="wb-icon-button"
            title="Collapse Folders in Explorer"
            onClick={() => setExpanded(new Set())}
          >
            <i className="codicon codicon-collapse-all" />
          </button>
        </div>
      </div>
      {isRootOpen && (
        <div
          ref={treeRef}
          className="wb-tree"
          role="tree"
          aria-label="Files Explorer"
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          <TreeLevel
            path={rootPath}
            depth={0}
            expanded={expanded}
            selectedPath={selectedPath}
            activePath={activePath}
            onActivateRow={activateRow}
          />
        </div>
      )}
    </div>
  );
}

type TreeLevelProps = {
  path: string;
  depth: number;
  expanded: ReadonlySet<string>;
  selectedPath: string | null;
  activePath: string | null;
  onActivateRow: (path: string, isDirectory: boolean, pin: boolean) => void;
};

function rowIndent(depth: number) {
  return { paddingLeft: 8 + depth * 8 };
}

function TreeLevel(props: TreeLevelProps) {
  const { path, depth, expanded, selectedPath, onActivateRow } = props;
  const { data: entries, error } = useDirectoryQuery(path);

  if (error) {
    return (
      <div className="wb-tree-message" style={rowIndent(depth)}>
        Unable to read this folder.
      </div>
    );
  }

  return entries?.map((entry) => {
    const isOpen = entry.isDirectory && expanded.has(entry.path);
    const isSelected = selectedPath === entry.path;
    return (
      <div key={entry.path} role="none">
        <div
          ref={isSelected ? (row) => row?.scrollIntoView({ block: "nearest" }) : undefined}
          className="wb-tree-row"
          role="treeitem"
          aria-selected={isSelected}
          aria-expanded={entry.isDirectory ? isOpen : undefined}
          data-path={entry.path}
          data-directory={entry.isDirectory}
          style={rowIndent(depth)}
          title={entry.path}
          onClick={() => onActivateRow(entry.path, entry.isDirectory, false)}
          onDoubleClick={() => onActivateRow(entry.path, entry.isDirectory, true)}
        >
          {entry.isDirectory ? (
            <i className={`wb-twistie codicon codicon-chevron-${isOpen ? "down" : "right"}`} />
          ) : (
            <span className="wb-twistie" />
          )}
          {entry.isDirectory ? (
            <FolderIcon name={entry.name} isOpen={isOpen} />
          ) : (
            <FileIcon name={entry.name} />
          )}
          <span className="wb-tree-label">{entry.name}</span>
        </div>
        {isOpen && <TreeLevel {...props} path={entry.path} depth={depth + 1} />}
      </div>
    );
  });
}
