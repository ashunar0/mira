import type { MouseEvent } from "react";
import { baseName, parentPath } from "../../../features/files/lib/path";
import { FileIcon } from "./fileIcon";
import type { Tab } from "./tabsReducer";

type Props = {
  tabs: Tab[];
  activePath: string | null;
  onActivate: (path: string) => void;
  onPin: (path: string) => void;
  onClose: (path: string) => void;
};

export function TabBar({ tabs, activePath, onActivate, onPin, onClose }: Props) {
  const handleAuxClick = (event: MouseEvent, path: string) => {
    if (event.button === 1) onClose(path);
  };

  return (
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
            title={tab.path}
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
  );
}
