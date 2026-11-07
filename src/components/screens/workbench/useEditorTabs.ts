import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { describeFileError, isFileError } from "../../../features/files/lib/fileError";
import { baseName } from "../../../features/files/lib/path";
import { useSaveFileMutation } from "../../../features/files/mutations";
import { useFileReader } from "../../../features/files/queries";
import type { FileContent } from "../../../features/files/type";
import { monaco } from "../../../infrastructure/monaco/setup";
import { askOverwrite, askSaveChoice, showError } from "../../../infrastructure/nativeDialog";
import { initialTabsState, tabsReducer } from "./tabsReducer";

type Buffer = {
  model: monaco.editor.ITextModel;
  /** undo で保存時点に戻ったら dirty が消えるよう、alternative version で比べる */
  savedVersionId: number;
  mtimeMs: number;
  hasBom: boolean;
  subscription: monaco.IDisposable;
};

export function useEditorTabs() {
  const [state, dispatch] = useReducer(tabsReducer, initialTabsState);
  const [focusRequest, setFocusRequest] = useState(0);
  const readFile = useFileReader();
  const { mutateAsync: writeFile } = useSaveFileMutation();

  const buffers = useRef(new Map<string, Buffer>());
  const saveChains = useRef(new Map<string, Promise<boolean>>());
  const latestOpen = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const requestFocus = useCallback(() => setFocusRequest((n) => n + 1), []);

  // タブから消えたファイルのモデルを捨てる。子の EditorPane が先に別モデルへ切り替えた後に走る
  useEffect(() => {
    for (const [path, buffer] of buffers.current) {
      if (state.tabs.some((tab) => tab.path === path)) continue;
      buffer.subscription.dispose();
      buffer.model.dispose();
      buffers.current.delete(path);
    }
  }, [state.tabs]);

  const createBuffer = useCallback((path: string, content: FileContent) => {
    const uri = monaco.Uri.file(path);
    const model = monaco.editor.createModel(content.text, undefined, uri);
    const subscription = model.onDidChangeContent(() => {
      const buffer = buffers.current.get(path);
      if (!buffer) return;
      const isDirty = model.getAlternativeVersionId() !== buffer.savedVersionId;
      dispatch({ type: "setDirty", path, isDirty });
    });
    buffers.current.set(path, {
      model,
      savedVersionId: model.getAlternativeVersionId(),
      mtimeMs: content.mtimeMs,
      hasBom: content.hasBom,
      subscription,
    });
  }, []);

  const openFile = useCallback(
    async (path: string, { pin }: { pin: boolean }) => {
      const request = ++latestOpen.current;
      let error: string | null = null;
      if (!buffers.current.has(path)) {
        try {
          const content = await readFile(path);
          // 読んでいる間に別のファイルが選ばれたら、そちらを優先する
          if (request !== latestOpen.current) return;
          createBuffer(path, content);
        } catch (cause) {
          if (request !== latestOpen.current) return;
          error = describeFileError(cause);
        }
      }
      dispatch({ type: "open", path, name: baseName(path), pin, error });
      // シングルクリックのプレビューはフォーカスを Explorer に残す
      if (pin) requestFocus();
    },
    [createBuffer, readFile, requestFocus],
  );

  const writeBuffer = useCallback(
    async (path: string, buffer: Buffer, expectedMtimeMs: number | null): Promise<boolean> => {
      const versionId = buffer.model.getAlternativeVersionId();
      try {
        buffer.mtimeMs = await writeFile({
          path,
          text: buffer.model.getValue(),
          hasBom: buffer.hasBom,
          expectedMtimeMs,
        });
      } catch (cause) {
        if (isFileError(cause) && cause.kind === "conflict") {
          const overwrite = await askOverwrite(
            `Failed to save '${baseName(path)}': The content of the file on disk is newer. Do you want to overwrite it with your changes?`,
          );
          return overwrite ? writeBuffer(path, buffer, null) : false;
        }
        await showError(`Failed to save '${baseName(path)}': ${describeFileError(cause)}`);
        return false;
      }
      buffer.savedVersionId = versionId;
      // 保存中に打った分は dirty のまま残す
      const isDirty = buffer.model.getAlternativeVersionId() !== versionId;
      dispatch({ type: "setDirty", path, isDirty });
      return true;
    },
    [writeFile],
  );

  /** 同じファイルの保存は直列にする。並走すると、先の保存で変わった mtime を衝突と誤認する */
  const saveFile = useCallback(
    (path: string): Promise<boolean> => {
      const previous = saveChains.current.get(path) ?? Promise.resolve(true);
      const next = previous.then(() => {
        const buffer = buffers.current.get(path);
        if (!buffer) return false;
        if (buffer.model.getAlternativeVersionId() === buffer.savedVersionId) return true;
        return writeBuffer(path, buffer, buffer.mtimeMs);
      });
      saveChains.current.set(path, next);
      return next;
    },
    [writeBuffer],
  );

  const saveActive = useCallback(() => {
    const { activePath } = stateRef.current;
    if (activePath) void saveFile(activePath);
  }, [saveFile]);

  const closeTab = useCallback(
    async (path: string) => {
      const tab = stateRef.current.tabs.find((t) => t.path === path);
      if (!tab) return;
      if (tab.isDirty) {
        const choice = await askSaveChoice(
          `Do you want to save the changes you made to ${tab.name}?\n\nYour changes will be lost if you don't save them.`,
          "Save",
        );
        if (choice === "cancel") return;
        if (choice === "save" && !(await saveFile(path))) return;
      }
      dispatch({ type: "close", path });
      requestFocus();
    },
    [requestFocus, saveFile],
  );

  /** 未保存があれば確認する。false なら呼び出し側は処理を取りやめる */
  const confirmDiscardAll = useCallback(async (): Promise<boolean> => {
    const dirty = stateRef.current.tabs.filter((tab) => tab.isDirty);
    if (dirty.length === 0) return true;
    const target =
      dirty.length === 1
        ? `the changes you made to ${dirty[0].name}`
        : `your changes to ${dirty.length} files`;
    const choice = await askSaveChoice(
      `Do you want to save ${target}?\n\nYour changes will be lost if you don't save them.`,
      dirty.length === 1 ? "Save" : "Save All",
    );
    if (choice === "cancel") return false;
    if (choice === "discard") return true;
    for (const tab of dirty) {
      if (!(await saveFile(tab.path))) return false;
    }
    return true;
  }, [saveFile]);

  const activate = useCallback(
    (path: string) => {
      dispatch({ type: "activate", path });
      requestFocus();
    },
    [requestFocus],
  );
  const pin = useCallback((path: string) => dispatch({ type: "pin", path }), []);
  const closeAll = useCallback(() => dispatch({ type: "closeAll" }), []);

  const activeTab = state.tabs.find((tab) => tab.path === state.activePath) ?? null;

  return {
    tabs: state.tabs,
    activeTab,
    activeModel: activeTab ? (buffers.current.get(activeTab.path)?.model ?? null) : null,
    activeHasBom: activeTab ? (buffers.current.get(activeTab.path)?.hasBom ?? false) : false,
    focusRequest,
    openFile,
    activate,
    pin,
    closeTab,
    closeAll,
    saveActive,
    confirmDiscardAll,
  };
}
