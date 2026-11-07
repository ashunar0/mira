import { useEffect, useRef, useState } from "react";
import { baseName } from "../../../features/files/lib/path";
import { useWorkspaceWatcher } from "../../../features/files/watcher";
import { useLanguageServer } from "../../../features/lsp/useLanguageServer";
import { useGitDecorationsQuery, useHeadTextQuery, useRefreshGitStatus } from "../../../features/git/queries";
import { useRefreshSearch } from "../../../features/search/queries";
import type { SearchMatch } from "../../../features/search/type";
import { closeWindow, onFolderRequested, onNativeMenu, onWindowCloseRequested } from "../../../infrastructure/appWindow";
import type { monaco } from "../../../infrastructure/monaco/setup";
import { pickFolder } from "../../../infrastructure/nativeDialog";
import { ActivityBar, type SidebarView } from "./activityBar";
import { Breadcrumbs } from "./breadcrumbs";
import { DiffPane } from "./diffPane";
import { EditorPane, type RevealRequest } from "./editorPane";
import { Explorer } from "./explorer";
import { MarkdownPreview } from "./markdownPreview";
import { COMMAND_PREFIX, type Command, QuickOpen } from "./quickOpen";
import { Sash } from "./sash";
import { SearchView } from "./searchView";
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
  const [sidebarView, setSidebarView] = useState<SidebarView>("explorer");
  const [searchText, setSearchText] = useState("");
  const [revealRequest, setRevealRequest] = useState<RevealRequest | null>(null);
  const [editorStatus, setEditorStatus] = useState<EditorStatus | null>(null);
  const [quickOpenText, setQuickOpenText] = useState<string | null>(null);
  // 切り替えたまま別のファイルへ移れるよう、タブごとではなく全体で持つ。出せないファイルは普通に開く
  const [wantedView, setWantedView] = useState<"editor" | "diff" | "preview">("editor");
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const previewTopLineRef = useRef<(() => number) | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const editorTabs = useEditorTabs(editorRef);
  const { tabs, activeTab, activeModel, activeHasBom, focusRequest, viewStates } = editorTabs;
  const { data: gitDecorations } = useGitDecorationsQuery(rootPath);
  const refreshGitStatus = useRefreshGitStatus();
  const refreshSearch = useRefreshSearch();
  useWorkspaceWatcher(rootPath, (changes) => {
    editorTabs.handleFileChanges(changes);
    void refreshGitStatus();
    void refreshSearch();
  });

  const canShowDiff = activeModel !== null && activeTab !== null && gitDecorations?.has(activeTab.path) === true;
  const { data: headText } = useHeadTextQuery(activeModel && activeTab ? activeTab.path : null);
  const isDiffVisible = wantedView === "diff" && canShowDiff && headText !== undefined;
  const canShowPreview = activeModel?.getLanguageId() === "markdown";
  const isPreviewVisible = wantedView === "preview" && canShowPreview;

  /** エディタへ戻してフォーカスも移す。target があれば、その行が見える位置まで動かす */
  const showEditor = (target?: { line: number; moveCursor: boolean }) => {
    const editor = editorRef.current;
    if (editor && target) {
      // 編集に入るときは、その行の少し上も見えるようにする
      const topLine = target.moveCursor ? Math.max(target.line - 3, 1) : target.line;
      editor.setScrollTop(editor.getTopForLineNumber(topLine));
      if (target.moveCursor) editor.setPosition({ lineNumber: target.line, column: 1 });
    }
    setWantedView("editor");
    if (activeTab) editorTabs.activate(activeTab.path);
  };

  const toggleDiff = () => {
    if (!canShowDiff) return;
    if (isDiffVisible) showEditor();
    else setWantedView("diff");
  };

  const togglePreview = () => {
    if (!canShowPreview) return;
    if (isPreviewVisible) showEditor({ line: previewTopLineRef.current?.() ?? 1, moveCursor: false });
    else setWantedView("preview");
  };

  const selectSidebarView = (view: SidebarView) => {
    setSidebarView(view);
    if (view === "search") requestAnimationFrame(() => searchInputRef.current?.select());
  };

  /** エディタで選んでいる語があれば、それを検索語にする */
  const findInFiles = () => {
    const editor = diffEditorRef.current?.getModifiedEditor() ?? editorRef.current;
    const selection = editor?.getSelection();
    const selected = selection && !selection.isEmpty() ? editor?.getModel()?.getValueInRange(selection) : "";
    if (selected && !selected.includes("\n")) setSearchText(selected);
    setIsSidebarVisible(true);
    selectSidebarView("search");
  };

  /** path を開いて、その位置を選ぶ。length が 0 ならカーソルを置くだけ */
  const openAt = (path: string, target: Omit<RevealRequest, "id" | "path">, options: { pin: boolean }) => {
    setWantedView("editor");
    setRevealRequest((current) => ({ id: (current?.id ?? 0) + 1, path, ...target }));
    void editorTabs.openFile(path, options);
  };

  const openSearchMatch = (path: string, match: SearchMatch, options: { pin: boolean }) =>
    openAt(path, { line: match.line, column: match.column, length: match.length }, options);

  // 別のファイルの定義へ飛んだら、そのままそこを読み進めるのでタブに固定する
  useLanguageServer(rootPath, (path, { line, column }) => openAt(path, { line, column, length: 0 }, { pin: true }));

  const toggleSidebar = () => setIsSidebarVisible((visible) => !visible);

  const openFolder = async (folder: string | null) => {
    if (!folder || folder === rootPath || !(await editorTabs.confirmDiscardAll())) return;
    editorTabs.closeAll();
    setRootPath(folder);
  };

  const chooseFolder = async () => openFolder(await pickFolder());

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
      { id: "open-folder", label: "File: Open Folder...", keybinding: ["⌘", "O"], run: () => void chooseFolder() },
      { id: "save", label: "File: Save", keybinding: ["⌘", "S"], run: editorTabs.saveActive },
      { id: "close-tab", label: "View: Close Editor", keybinding: ["⌘", "W"], run: closeActiveOrWindow },
      { id: "toggle-sidebar", label: "View: Toggle Primary Side Bar Visibility", keybinding: ["⌘", "B"], run: toggleSidebar },
      { id: "toggle-diff", label: "View: Toggle Diff", keybinding: ["⇧", "⌘", "D"], run: toggleDiff },
      { id: "toggle-preview", label: "Markdown: Toggle Preview", keybinding: ["⇧", "⌘", "V"], run: togglePreview },
      ...(isDiffVisible
        ? [
            { id: "next-change", label: "View: Next Change", keybinding: ["⌥", "⌘", "↓"], run: () => diffEditorRef.current?.goToDiff("next") },
            { id: "previous-change", label: "View: Previous Change", keybinding: ["⌥", "⌘", "↑"], run: () => diffEditorRef.current?.goToDiff("previous") },
          ]
        : []),
      { id: "find-in-files", label: "Search: Find in Files", keybinding: ["⇧", "⌘", "F"], run: findInFiles },
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
    "open-folder": () => void chooseFolder(),
    save: editorTabs.saveActive,
    "close-tab": closeActiveOrWindow,
    "toggle-sidebar": toggleSidebar,
    "toggle-diff": toggleDiff,
    "toggle-preview": togglePreview,
    "find-in-files": findInFiles,
    "quick-open": () => setQuickOpenText(""),
    "command-palette": showCommands,
    quit: () => void closeWindow(),
  };
  useEffect(() => onNativeMenu((id) => menuHandlers.current[id]?.()), []);

  const openFolderRef = useRef(openFolder);
  openFolderRef.current = openFolder;
  useEffect(() => onFolderRequested((path) => void openFolderRef.current(path)), []);

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
        title={title || "Mira"}
        isSidebarVisible={isSidebarVisible}
        onToggleSidebar={toggleSidebar}
      />
      <div className="wb-main">
        {isSidebarVisible && (
          <div className="wb-sidebar-slot" style={{ width: sidebarWidth }}>
            <aside className="wb-sidebar">
              <ActivityBar active={sidebarView} onSelect={selectSidebarView} />
              {/* 切り替えても開いたフォルダや検索結果が残るよう、隠すだけにする */}
              <div className="wb-sidebar-view" hidden={sidebarView !== "explorer"}>
                <Explorer
                  rootPath={rootPath}
                  activePath={activeTab?.path ?? null}
                  onOpenFile={(path, options) => void editorTabs.openFile(path, options)}
                  onOpenFolder={() => void chooseFolder()}
                  onPathRenamed={editorTabs.handlePathRenamed}
                  onPathDeleted={editorTabs.handlePathDeleted}
                  countUnsavedWithin={editorTabs.countUnsavedWithin}
                />
              </div>
              <div className="wb-sidebar-view" hidden={sidebarView !== "search"}>
                <div className="wb-sidebar-title">Search</div>
                {rootPath ? (
                  <SearchView
                    key={rootPath}
                    rootPath={rootPath}
                    isVisible={sidebarView === "search"}
                    text={searchText}
                    onTextChange={setSearchText}
                    inputRef={searchInputRef}
                    onOpenMatch={openSearchMatch}
                  />
                ) : (
                  <div className="wb-no-folder">
                    <p>Open a folder to search.</p>
                  </div>
                )}
              </div>
            </aside>
          </div>
        )}
        <main className="wb-editor-area">
          {tabs.length > 0 && (
            <TabBar
              tabs={tabs}
              activePath={activeTab?.path ?? null}
              gitDecorations={gitDecorations}
              actions={
                canShowPreview || canShowDiff ? (
                  <>
                    {canShowPreview && (
                      <button
                        type="button"
                        className="wb-icon-button"
                        title="Toggle Preview (⇧⌘V)"
                        aria-pressed={isPreviewVisible}
                        onClick={togglePreview}
                      >
                        <i className="codicon codicon-open-preview" />
                      </button>
                    )}
                    {canShowDiff && (
                      <button
                        type="button"
                        className="wb-icon-button"
                        title="Toggle Diff (⇧⌘D)"
                        aria-pressed={isDiffVisible}
                        onClick={toggleDiff}
                      >
                        <i className="codicon codicon-diff" />
                      </button>
                    )}
                  </>
                ) : null
              }
              onActivate={editorTabs.activate}
              onPin={editorTabs.pin}
              onClose={(path) => void editorTabs.closeTab(path)}
            />
          )}
          {activeTab && <Breadcrumbs rootPath={rootPath} path={activeTab.path} />}
          <div className="wb-editor-content">
            <EditorPane
              model={activeModel}
              isHidden={isDiffVisible || isPreviewVisible}
              revealRequest={revealRequest}
              gutterBaseText={isDiffVisible || isPreviewVisible ? null : (headText ?? null)}
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
            {isPreviewVisible && activeModel && (
              <MarkdownPreview
                model={activeModel}
                editorRef={editorRef}
                topLineRef={previewTopLineRef}
                onEditLine={(line) => showEditor({ line, moveCursor: true })}
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
