export type Tab = {
  path: string;
  name: string;
  isPreview: boolean;
  isDirty: boolean;
  /** 開いた後にディスクから消えた。保存すれば作り直せるのでタブは残す */
  isDeleted: boolean;
  /** 開けなかったファイルは、タブを出してエディタの代わりに理由を表示する */
  error: string | null;
};

export type TabsState = {
  tabs: Tab[];
  activePath: string | null;
  /** 最近使った順。閉じた後に戻る先を決める（workbench.editor.focusRecentEditorAfterClose） */
  recent: string[];
};

export type TabsAction =
  | { type: "open"; path: string; name: string; pin: boolean; error: string | null }
  | { type: "activate"; path: string }
  | { type: "pin"; path: string }
  | { type: "setDirty"; path: string; isDirty: boolean }
  | { type: "setDeleted"; path: string; isDeleted: boolean }
  | { type: "close"; path: string }
  | { type: "closeAll" };

export const initialTabsState: TabsState = { tabs: [], activePath: null, recent: [] };

const touch = (recent: string[], path: string) => [path, ...recent.filter((p) => p !== path)];

function updateTab(state: TabsState, path: string, patch: Partial<Tab>): TabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.path === path ? { ...tab, ...patch } : tab)),
  };
}

function open(state: TabsState, action: Extract<TabsAction, { type: "open" }>): TabsState {
  const { path, name, pin, error } = action;

  const existing = state.tabs.find((tab) => tab.path === path);
  if (existing) {
    return {
      ...updateTab(state, path, { error, isPreview: existing.isPreview && !pin }),
      activePath: path,
      recent: touch(state.recent, path),
    };
  }

  const tab: Tab = { path, name, isPreview: !pin, isDirty: false, isDeleted: false, error };

  // プレビュータブは 1 つだけ。次のプレビューはその場所を引き継ぐ
  const previewIndex = state.tabs.findIndex((t) => t.isPreview);
  if (!pin && previewIndex !== -1) {
    const replaced = state.tabs[previewIndex].path;
    return {
      tabs: state.tabs.map((t, index) => (index === previewIndex ? tab : t)),
      activePath: path,
      recent: touch(state.recent.filter((p) => p !== replaced), path),
    };
  }

  // 新しいタブはアクティブなタブの右に開く（workbench.editor.openPositioning: right）
  const activeIndex = state.tabs.findIndex((t) => t.path === state.activePath);
  const tabs = [...state.tabs];
  tabs.splice(activeIndex + 1, 0, tab);
  return { tabs, activePath: path, recent: touch(state.recent, path) };
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case "open":
      return open(state, action);
    case "activate":
      return { ...state, activePath: action.path, recent: touch(state.recent, action.path) };
    case "pin":
      return updateTab(state, action.path, { isPreview: false });
    case "setDirty": {
      const tab = state.tabs.find((t) => t.path === action.path);
      if (!tab || tab.isDirty === action.isDirty) return state;
      // 編集したプレビュータブは固定する
      const isPreview = tab.isPreview && !action.isDirty;
      return updateTab(state, action.path, { isDirty: action.isDirty, isPreview });
    }
    case "setDeleted": {
      const tab = state.tabs.find((t) => t.path === action.path);
      if (!tab || tab.isDeleted === action.isDeleted) return state;
      return updateTab(state, action.path, { isDeleted: action.isDeleted });
    }
    case "close": {
      const recent = state.recent.filter((p) => p !== action.path);
      return {
        tabs: state.tabs.filter((tab) => tab.path !== action.path),
        activePath: state.activePath === action.path ? (recent[0] ?? null) : state.activePath,
        recent,
      };
    }
    case "closeAll":
      return initialTabsState;
  }
}
