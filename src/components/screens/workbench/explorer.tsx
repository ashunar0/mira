import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import { describeFileError } from "../../../features/files/lib/fileError";
import { ancestorsWithin, baseName, parentPath, rebasePath } from "../../../features/files/lib/path";
import {
  useCreateDirectoryMutation,
  useCreateFileMutation,
  useDeletePathMutation,
  useRenamePathMutation,
} from "../../../features/files/mutations";
import { useRefreshDirectories } from "../../../features/files/queries";
import type { DirEntry } from "../../../features/files/type";
import { useGitDecorationsQuery } from "../../../features/git/queries";
import { askMoveToTrash, showError } from "../../../infrastructure/nativeDialog";
import { copyText, revealInFinder, showContextMenu } from "../../../infrastructure/nativeShell";
import { ActivityBar } from "./activityBar";
import { type ExplorerEdit, ExplorerTreeLevel } from "./explorerTree";

type Props = {
  rootPath: string | null;
  activePath: string | null;
  onOpenFile: (path: string, options: { pin: boolean }) => void;
  onOpenFolder: () => void;
  onPathRenamed: (from: string, to: string) => void;
  onPathDeleted: (path: string) => void;
  countUnsavedWithin: (path: string) => number;
};

export function Explorer(props: Props) {
  const { rootPath, onOpenFolder } = props;
  return (
    <aside className="wb-sidebar">
      <ActivityBar />
      <div className="wb-sidebar-title">Explorer</div>
      {rootPath ? (
        <FolderTree key={rootPath} {...props} rootPath={rootPath} />
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

function deleteMessage(name: string, isDirectory: boolean, unsavedCount: number): string {
  const restore = "You can restore this file from the Trash.";
  if (unsavedCount > 0) {
    const target = isDirectory
      ? `a folder ${name} with unsaved changes in ${unsavedCount} file${unsavedCount > 1 ? "s" : ""}`
      : `${name} with unsaved changes`;
    return `You are deleting ${target}. Do you want to continue?\n\n${restore}`;
  }
  const question = isDirectory
    ? `Are you sure you want to delete '${name}' and its contents?`
    : `Are you sure you want to delete '${name}'?`;
  return `${question}\n\n${restore}`;
}

function FolderTree(props: FolderTreeProps) {
  const { rootPath, activePath, onOpenFile, onPathRenamed, onPathDeleted, countUnsavedWithin } = props;
  const [isRootOpen, setIsRootOpen] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<{ path: string; isDirectory: boolean } | null>(null);
  const [edit, setEdit] = useState<ExplorerEdit | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const refresh = useRefreshDirectories();
  const { data: gitDecorations } = useGitDecorationsQuery(rootPath);
  const { mutateAsync: createFile } = useCreateFileMutation();
  const { mutateAsync: createDirectory } = useCreateDirectoryMutation();
  const { mutateAsync: renamePath } = useRenamePathMutation();
  const { mutateAsync: deletePath } = useDeletePathMutation();

  const selectedPath = selected?.path ?? null;

  const setExpansion = (path: string, isOpen: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (isOpen) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  const focusTree = () => treeRef.current?.focus();

  // アクティブなファイルを Explorer に表示する（explorer.autoReveal）
  useEffect(() => {
    if (!activePath || !activePath.startsWith(`${rootPath}/`)) return;
    setSelected({ path: activePath, isDirectory: false });
    setIsRootOpen(true);
    setExpanded((current) => new Set([...current, ...ancestorsWithin(rootPath, activePath)]));
  }, [activePath, rootPath]);

  const activateRow = (path: string, isDirectory: boolean, pin: boolean) => {
    setSelected({ path, isDirectory });
    if (isDirectory) {
      if (!pin) setExpansion(path, !expanded.has(path));
    } else {
      onOpenFile(path, { pin });
    }
  };

  /** 新規作成の置き場所: 選んでいるのがフォルダならその中、ファイルなら同じ階層 */
  const creationParent = (target: { path: string; isDirectory: boolean } | null) => {
    if (!target) return rootPath;
    return target.isDirectory ? target.path : parentPath(target.path);
  };

  const startCreating = (kind: "newFile" | "newFolder", parent: string) => {
    setIsRootOpen(true);
    setExpanded((current) => new Set([...current, ...ancestorsWithin(rootPath, `${parent}/_`)]));
    setEdit({ kind, parent });
  };

  const commitEdit = async (name: string) => {
    if (!edit) return;
    if (edit.kind === "rename") {
      const to = `${parentPath(edit.path)}/${name}`;
      await renamePath({ from: edit.path, to });
      onPathRenamed(edit.path, to);
      setExpanded((current) => new Set([...current].map((p) => rebasePath(p, edit.path, to))));
      setSelected((current) => current && { ...current, path: rebasePath(current.path, edit.path, to) });
      focusTree();
    } else {
      const path = `${edit.parent}/${name}`;
      if (edit.kind === "newFile") {
        await createFile(path);
        onOpenFile(path, { pin: true });
      } else {
        await createDirectory(path);
        setExpanded((current) => new Set([...current, ...ancestorsWithin(rootPath, `${path}/_`)]));
        setSelected({ path, isDirectory: true });
        focusTree();
      }
    }
    setEdit(null);
  };

  const cancelEdit = () => {
    setEdit(null);
    focusTree();
  };

  const startRename = (path: string) => setEdit({ kind: "rename", path, name: baseName(path) });

  const deleteEntry = async (path: string, isDirectory: boolean) => {
    const message = deleteMessage(baseName(path), isDirectory, countUnsavedWithin(path));
    if (!(await askMoveToTrash(message))) return focusTree();
    try {
      await deletePath(path);
      onPathDeleted(path);
      setSelected(null);
    } catch (cause) {
      await showError(`Failed to delete '${baseName(path)}': ${describeFileError(cause)}`);
    }
    focusTree();
  };

  const relativePath = (path: string) => (path === rootPath ? "." : path.slice(rootPath.length + 1));

  const openContextMenu = (event: MouseEvent, entry: DirEntry | null) => {
    event.preventDefault();
    event.stopPropagation();
    const target = entry && { path: entry.path, isDirectory: entry.isDirectory };
    setSelected(target);
    focusTree();
    const path = entry?.path ?? rootPath;
    void showContextMenu([
      { label: "New File...", run: () => startCreating("newFile", creationParent(target)) },
      { label: "New Folder...", run: () => startCreating("newFolder", creationParent(target)) },
      "separator",
      { label: "Reveal in Finder", run: () => void revealInFinder(path) },
      "separator",
      { label: "Copy Path", run: () => void copyText(path) },
      { label: "Copy Relative Path", run: () => void copyText(relativePath(path)) },
      ...(entry
        ? ([
            "separator",
            { label: "Rename...", run: () => startRename(entry.path) },
            { label: "Delete", run: () => void deleteEntry(entry.path, entry.isDirectory) },
          ] as const)
        : []),
    ]);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const rows = [...(treeRef.current?.querySelectorAll<HTMLElement>("[data-path]") ?? [])];
    const index = rows.findIndex((row) => row.dataset.path === selectedPath);
    const current = rows[index];
    const currentPath = current?.dataset.path;
    const isDirectory = current?.dataset.directory === "true";
    const select = (row: HTMLElement | undefined) => {
      if (row?.dataset.path) {
        setSelected({ path: row.dataset.path, isDirectory: row.dataset.directory === "true" });
      }
    };

    // macOS の VS Code と同じ: Enter でリネーム、⌘↓ で開く、⌘⌫ でゴミ箱へ
    if (event.metaKey && event.key === "ArrowDown") {
      if (currentPath && !isDirectory) onOpenFile(currentPath, { pin: true });
      else if (currentPath) setExpansion(currentPath, !expanded.has(currentPath));
      event.preventDefault();
      return;
    }
    if (event.metaKey && event.key === "Backspace") {
      if (currentPath) void deleteEntry(currentPath, isDirectory);
      event.preventDefault();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    switch (event.key) {
      case "ArrowDown":
        select(rows[index + 1] ?? rows[0]);
        break;
      case "ArrowUp":
        select(rows[index - 1] ?? rows[0]);
        break;
      case "ArrowRight":
        if (currentPath && isDirectory) {
          if (expanded.has(currentPath)) select(rows[index + 1]);
          else setExpansion(currentPath, true);
        }
        break;
      case "ArrowLeft":
        if (!currentPath) break;
        if (expanded.has(currentPath)) {
          setExpansion(currentPath, false);
        } else {
          const parent = parentPath(currentPath);
          if (parent !== rootPath) setSelected({ path: parent, isDirectory: true });
        }
        break;
      case "Enter":
      case "F2":
        if (currentPath) startRename(currentPath);
        break;
      case " ":
        if (currentPath && isDirectory) setExpansion(currentPath, !expanded.has(currentPath));
        else if (currentPath) onOpenFile(currentPath, { pin: false });
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const headerAction = (title: string, icon: string, onClick: () => void) => (
    <button type="button" className="wb-icon-button" title={title} onClick={onClick}>
      <i className={`codicon codicon-${icon}`} />
    </button>
  );

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
          {headerAction("New File...", "new-file", () => startCreating("newFile", creationParent(selected)))}
          {headerAction("New Folder...", "new-folder", () => startCreating("newFolder", creationParent(selected)))}
          {headerAction("Refresh Explorer", "refresh", () => void refresh())}
          {headerAction("Collapse Folders in Explorer", "collapse-all", () => setExpanded(new Set()))}
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
          onContextMenu={(event) => openContextMenu(event, null)}
        >
          <ExplorerTreeLevel
            path={rootPath}
            depth={0}
            expanded={expanded}
            selectedPath={selectedPath}
            edit={edit}
            gitDecorations={gitDecorations}
            onActivateRow={activateRow}
            onRowContextMenu={openContextMenu}
            onCommitEdit={commitEdit}
            onCancelEdit={cancelEdit}
          />
        </div>
      )}
    </div>
  );
}
