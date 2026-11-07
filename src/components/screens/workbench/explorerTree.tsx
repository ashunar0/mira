import type { MouseEvent } from "react";
import { useDirectoryQuery } from "../../../features/files/queries";
import type { DirEntry } from "../../../features/files/type";
import { ExplorerNameInput } from "./explorerNameInput";
import { FileIcon, FolderIcon } from "./fileIcon";

export type ExplorerEdit =
  | { kind: "newFile" | "newFolder"; parent: string }
  | { kind: "rename"; path: string; name: string };

type Props = {
  path: string;
  depth: number;
  expanded: ReadonlySet<string>;
  selectedPath: string | null;
  edit: ExplorerEdit | null;
  onActivateRow: (path: string, isDirectory: boolean, pin: boolean) => void;
  onRowContextMenu: (event: MouseEvent, entry: DirEntry) => void;
  onCommitEdit: (name: string) => Promise<void>;
  onCancelEdit: () => void;
};

function rowIndent(depth: number) {
  return { paddingLeft: 8 + depth * 8 };
}

export function ExplorerTreeLevel(props: Props) {
  const { path, depth, expanded, selectedPath, edit, onActivateRow, onRowContextMenu } = props;
  const { onCommitEdit, onCancelEdit } = props;
  const { data: entries, error } = useDirectoryQuery(path);

  if (error) {
    return (
      <div className="wb-tree-message" style={rowIndent(depth)}>
        Unable to read this folder.
      </div>
    );
  }
  if (!entries) return null;

  const isCreatingHere = edit && edit.kind !== "rename" && edit.parent === path;

  return (
    <>
      {isCreatingHere && (
        <div className="wb-tree-row" role="none" style={rowIndent(depth)}>
          {edit.kind === "newFolder" ? (
            <>
              <i className="wb-twistie codicon codicon-chevron-right" />
              <FolderIcon name="" isOpen={false} />
            </>
          ) : (
            <>
              <span className="wb-twistie" />
              <FileIcon name="" />
            </>
          )}
          <ExplorerNameInput
            initialName=""
            siblings={entries}
            onCommit={onCommitEdit}
            onCancel={onCancelEdit}
          />
        </div>
      )}
      {entries.map((entry) => {
        const isOpen = entry.isDirectory && expanded.has(entry.path);
        const isSelected = selectedPath === entry.path;
        const isRenaming = edit?.kind === "rename" && edit.path === entry.path;
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
              onContextMenu={(event) => onRowContextMenu(event, entry)}
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
              {isRenaming ? (
                <ExplorerNameInput
                  initialName={entry.name}
                  siblings={entries}
                  onCommit={onCommitEdit}
                  onCancel={onCancelEdit}
                />
              ) : (
                <span className="wb-tree-label">{entry.name}</span>
              )}
            </div>
            {isOpen && <ExplorerTreeLevel {...props} path={entry.path} depth={depth + 1} />}
          </div>
        );
      })}
    </>
  );
}
