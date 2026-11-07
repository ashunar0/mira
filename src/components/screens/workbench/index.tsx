import { useEffect, useRef, useState } from "react";
import { baseName } from "../../../features/files/lib/path";
import { closeWindow, onNativeMenu, onWindowCloseRequested } from "../../../infrastructure/appWindow";
import { pickFolder } from "../../../infrastructure/nativeDialog";
import { Breadcrumbs } from "./breadcrumbs";
import { EditorPane } from "./editorPane";
import { Explorer } from "./explorer";
import { Sash } from "./sash";
import { type EditorStatus, StatusBar } from "./statusBar";
import { useStoredPreference } from "./storedPreference";
import { TabBar } from "./tabBar";
import { TitleBar } from "./titleBar";
import { useEditorTabs } from "./useEditorTabs";
import { Watermark } from "./watermark";
// Monaco も codicon の CSS を読み込むので、上書きできるよう最後に置く
import "./workbench.css";

const SIDEBAR_DEFAULT_WIDTH = 300;
const SIDEBAR_MIN_WIDTH = 170;
const EDITOR_MIN_WIDTH = 220;

export function Workbench() {
  const [rootPath, setRootPath] = useStoredPreference<string | null>("mira.rootPath", null);
  const [sidebarWidth, setSidebarWidth] = useStoredPreference("mira.sidebarWidth", SIDEBAR_DEFAULT_WIDTH);
  const [isSidebarVisible, setIsSidebarVisible] = useStoredPreference("mira.sidebarVisible", true);
  const [editorStatus, setEditorStatus] = useState<EditorStatus | null>(null);
  const editorTabs = useEditorTabs();
  const { tabs, activeTab, activeModel, activeHasBom, focusRequest } = editorTabs;

  const toggleSidebar = () => setIsSidebarVisible((visible) => !visible);

  const openFolder = async () => {
    const folder = await pickFolder();
    if (!folder || !(await editorTabs.confirmDiscardAll())) return;
    editorTabs.closeAll();
    setRootPath(folder);
  };

  const closeActiveOrWindow = () => {
    if (activeTab) void editorTabs.closeTab(activeTab.path);
    else void closeWindow();
  };

  const resizeSidebar = (clientX: number) => {
    const max = window.innerWidth - EDITOR_MIN_WIDTH;
    setSidebarWidth(Math.round(Math.min(Math.max(clientX, SIDEBAR_MIN_WIDTH), max)));
  };

  // ネイティブメニューは一度だけ購読し、常に最新の描画のハンドラを呼ぶ
  const menuHandlers = useRef<Record<string, () => void>>({});
  menuHandlers.current = {
    "open-folder": () => void openFolder(),
    save: editorTabs.saveActive,
    "close-tab": closeActiveOrWindow,
    "toggle-sidebar": toggleSidebar,
    quit: () => void closeWindow(),
  };
  useEffect(() => onNativeMenu((id) => menuHandlers.current[id]?.()), []);

  const { confirmDiscardAll } = editorTabs;
  useEffect(() => onWindowCloseRequested(confirmDiscardAll), [confirmDiscardAll]);

  const folderName = rootPath ? baseName(rootPath) : null;
  const dirtyMark = activeTab?.isDirty ? "● " : "";
  const title = [activeTab && `${dirtyMark}${activeTab.name}`, folderName]
    .filter(Boolean)
    .join(" — ");

  return (
    <div className="wb-root">
      <TitleBar
        title={title || "mira"}
        isSidebarVisible={isSidebarVisible}
        onToggleSidebar={toggleSidebar}
      />
      <div className="wb-main">
        {isSidebarVisible && (
          <div className="wb-sidebar-slot" style={{ width: sidebarWidth }}>
            <Explorer
              rootPath={rootPath}
              activePath={activeTab?.path ?? null}
              onOpenFile={(path, options) => void editorTabs.openFile(path, options)}
              onOpenFolder={() => void openFolder()}
            />
          </div>
        )}
        <main className="wb-editor-area">
          {tabs.length > 0 && (
            <TabBar
              tabs={tabs}
              activePath={activeTab?.path ?? null}
              onActivate={editorTabs.activate}
              onPin={editorTabs.pin}
              onClose={(path) => void editorTabs.closeTab(path)}
            />
          )}
          {activeTab && <Breadcrumbs rootPath={rootPath} path={activeTab.path} />}
          <div className="wb-editor-content">
            <EditorPane
              model={activeModel}
              focusRequest={focusRequest}
              onStatusChange={setEditorStatus}
            />
            {!activeTab && <Watermark />}
            {activeTab?.error && <div className="wb-editor-message">{activeTab.error}</div>}
          </div>
        </main>
        {isSidebarVisible && (
          <Sash
            left={sidebarWidth}
            onResize={resizeSidebar}
            onReset={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
          />
        )}
      </div>
      <StatusBar hasFolder={rootPath !== null} status={editorStatus} hasBom={activeHasBom} />
    </div>
  );
}
