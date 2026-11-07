import type { MouseEvent } from "react";
import { baseName, parentPath } from "../../../features/files/lib/path";
import type { GitFileState } from "../../../features/git/type";
import { FileIcon } from "./fileIcon";
import type { Tab } from "./tabsReducer";

type Props = {
  tabs: Tab[];
  activePath: string | null;
  gitDecorations: ReadonlyMap<string, GitFileState> | undefined;
  /** アクティブなファイルに変更があるときだけ、diff の切り替えボタンを出す */
  canShowDiff: boolean;
  isDiffVisible: boolean;
  onToggleDiff: () => void;
  onActivate: (path: string) => void;
  onPin: (path: string) => void;
  onClose: (path: string) => void;
};

export function TabBar(props: Props) {
  const { tabs, activePath, gitDecorations, canShowDiff, isDiffVisible, onToggleDiff } = props;
  const { onActivate, onPin, onClose } = props;
  const handleAuxClick = (event: MouseEvent, path: string) => {
    if (event.button === 1) onClose(path);
  };

  return (
    <div className="wb-tabs-row">
      <div
        className="wb-tabs"
        role="tablist"
        onWheel={(event) => {
          event.currentTarget.scrollLeft += event.deltaX + event.deltaY;
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.path === activePath;
          // 同じ名前のタブがあれば、見分けられるよう親フォルダを添える
          const isAmbiguous = tabs.some((t) => t.name === tab.name && t.path !== tab.path);
          return (
            <div
              key={tab.path}
              ref={isActive ? (el) => el?.scrollIntoView({ block: "nearest", inline: "nearest" }) : undefined}
              className="wb-tab"
              role="tab"
              aria-selected={isActive}
              data-preview={tab.isPreview}
              data-dirty={tab.isDirty}
              data-deleted={tab.isDeleted}
              data-git={gitDecorations?.get(tab.path)}
              title={tab.isDeleted ? `${tab.path} (deleted)` : tab.path}
              onMouseDown={(event) => {
                if (event.button === 0) onActivate(tab.path);
              }}
              onDoubleClick={() => onPin(tab.path)}
              onAuxClick={(event) => handleAuxClick(event, tab.path)}
            >
              <FileIcon name={tab.name} />
              <span className="wb-tab-label">{tab.name}</span>
              {isAmbiguous && (
                <span className="wb-tab-description">{baseName(parentPath(tab.path))}</span>
              )}
              <button
                type="button"
                className="wb-tab-close"
                title="Close (⌘W)"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => onClose(tab.path)}
              >
                <i className="codicon codicon-close" />
                <i className="codicon codicon-circle-filled" />
              </button>
            </div>
          );
        })}
      </div>
      {canShowDiff && (
        <div className="wb-tabs-actions">
          <button
            type="button"
            className="wb-icon-button"
            title="Toggle Diff (⇧⌘D)"
            aria-pressed={isDiffVisible}
            onClick={onToggleDiff}
          >
            <i className="codicon codicon-diff" />
          </button>
        </div>
      )}
    </div>
  );
}
