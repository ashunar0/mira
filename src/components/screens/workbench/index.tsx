import { useEffect, useRef, useState } from "react";
import { baseName } from "../../../features/files/lib/path";
import { useWorkspaceWatcher } from "../../../features/files/watcher";
import { useGitDecorationsQuery, useHeadTextQuery, useRefreshGitStatus } from "../../../features/git/queries";
import { closeWindow, onNativeMenu, onWindowCloseRequested } from "../../../infrastructure/appWindow";
import type { monaco } from "../../../infrastructure/monaco/setup";
import { pickFolder } from "../../../infrastructure/nativeDialog";
import { Breadcrumbs } from "./breadcrumbs";
import { DiffPane } from "./diffPane";
import { EditorPane } from "./editorPane";
import { Explorer } from "./explorer";
import { COMMAND_PREFIX, type Command, QuickOpen } from "./quickOpen";
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
  const [quickOpenText, setQuickOpenText] = useState<string | null>(null);
  const [isDiffWanted, setIsDiffWanted] = useState(false);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const editorTabs = useEditorTabs(editorRef);
  const { tabs, activeTab, activeModel, activeHasBom, focusRequest, viewStates } = editorTabs;
  const { data: gitDecorations } = useGitDecorationsQuery(rootPath);
  const refreshGitStatus = useRefreshGitStatus();
  useWorkspaceWatcher(rootPath, (changes) => {
    editorTabs.handleFileChanges(changes);
    void refreshGitStatus();
  });

  // diff のまま別のファイルへ移れるよう、タブごとではなく全体で持つ。変更がないファイルは普通に開く
  const canShowDiff = activeModel !== null && activeTab !== null && gitDecorations?.has(activeTab.path) === true;
  const { data: headText } = useHeadTextQuery(isDiffWanted && canShowDiff ? activeTab.path : null);
  const isDiffVisible = isDiffWanted && canShowDiff && headText !== undefined;

  const toggleDiff = () => {
    if (!canShowDiff) return;
    setIsDiffWanted(!isDiffVisible);
    // エディタへ戻るときはカーソルも戻す
    if (isDiffVisible) editorTabs.activate(activeTab.path);
  };

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

  const getCommands = (): Command[] => {
    const appCommands: Command[] = [
      { id: "open-folder", label: "File: Open Folder...", keybinding: ["⌘", "O"], run: () => void openFolder() },
      { id: "save", label: "File: Save", keybinding: ["⌘", "S"], run: editorTabs.saveActive },
      { id: "close-tab", label: "View: Close Editor", keybinding: ["⌘", "W"], run: closeActiveOrWindow },
      { id: "toggle-sidebar", label: "View: Toggle Primary Side Bar Visibility", keybinding: ["⌘", "B"], run: toggleSidebar },
      { id: "toggle-diff", label: "View: Toggle Diff", keybinding: ["⇧", "⌘", "D"], run: toggleDiff },
      ...(isDiffVisible
        ? [
            { id: "next-change", label: "View: Next Change", keybinding: ["⌥", "⌘", "↓"], run: () => diffEditorRef.current?.goToDiff("next") },
            { id: "previous-change", label: "View: Previous Change", keybinding: ["⌥", "⌘", "↑"], run: () => diffEditorRef.current?.goToDiff("previous") },
          ]
        : []),
      { id: "quick-open", label: "Go to File...", keybinding: ["⌘", "P"], run: () => setQuickOpenText("") },
    ];
    // Monaco の編集コマンドも並べる。パレットは自前なので Monaco 自身のパレットは除く
    const editor = diffEditorRef.current?.getModifiedEditor() ?? editorRef.current;
    const editorCommands: Command[] = editor?.getModel()
      ? editor
          .getSupportedActions()
          .filter((action) => action.id !== "editor.action.quickCommand" && action.label)
          .map((action) => ({
            id: action.id,
            label: action.label,
            run: () => {
              editor.focus();
              void action.run();
            },
          }))
      : [];
    return [...appCommands, ...editorCommands];
  };

  const showCommands = () => setQuickOpenText(COMMAND_PREFIX);

  // ネイティブメニューは一度だけ購読し、常に最新の描画のハンドラを呼ぶ
  const menuHandlers = useRef<Record<string, () => void>>({});
  menuHandlers.current = {
    "open-folder": () => void openFolder(),
    save: editorTabs.saveActive,
    "close-tab": closeActiveOrWindow,
    "toggle-sidebar": toggleSidebar,
    "toggle-diff": toggleDiff,
    "quick-open": () => setQuickOpenText(""),
    "command-palette": showCommands,
    quit: () => void closeWindow(),
  };
  useEffect(() => onNativeMenu((id) => menuHandlers.current[id]?.()), []);

  // F1 は Monaco 自身のパレットより先に受け取る（ネイティブメニューには同じ機能を 2 つのキーで置けない）
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F1") return;
      event.preventDefault();
      event.stopPropagation();
      setQuickOpenText(COMMAND_PREFIX);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

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
              onPathRenamed={editorTabs.handlePathRenamed}
              onPathDeleted={editorTabs.handlePathDeleted}
              countUnsavedWithin={editorTabs.countUnsavedWithin}
            />
          </div>
        )}
        <main className="wb-editor-area">
          {tabs.length > 0 && (
            <TabBar
              tabs={tabs}
              activePath={activeTab?.path ?? null}
              gitDecorations={gitDecorations}
              canShowDiff={canShowDiff}
              isDiffVisible={isDiffVisible}
              onToggleDiff={toggleDiff}
              onActivate={editorTabs.activate}
              onPin={editorTabs.pin}
              onClose={(path) => void editorTabs.closeTab(path)}
            />
          )}
          {activeTab && <Breadcrumbs rootPath={rootPath} path={activeTab.path} />}
          <div className="wb-editor-content">
            <EditorPane
              model={activeModel}
              isHidden={isDiffVisible}
              focusRequest={focusRequest}
              editorRef={editorRef}
              viewStates={viewStates}
              onStatusChange={setEditorStatus}
            />
            {isDiffVisible && activeModel && (
              <DiffPane
                model={activeModel}
                originalText={headText ?? ""}
                focusRequest={focusRequest}
                editorRef={diffEditorRef}
                onStatusChange={setEditorStatus}
              />
            )}
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
      {quickOpenText !== null && (
        <QuickOpen
          text={quickOpenText}
          rootPath={rootPath}
          recentPaths={editorTabs.getHistory()}
          getCommands={getCommands}
          onTextChange={setQuickOpenText}
          onOpenFile={(path) => void editorTabs.openFile(path, { pin: true })}
          onClose={() => setQuickOpenText(null)}
        />
      )}
      <StatusBar hasFolder={rootPath !== null} status={editorStatus} hasBom={activeHasBom} />
    </div>
  );
}
