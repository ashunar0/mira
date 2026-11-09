import { type RefObject, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { describeFileError, isFileError } from "../../../features/files/lib/fileError";
import { baseName, isWithin, rebasePath } from "../../../features/files/lib/path";
import { useSaveFileMutation } from "../../../features/files/mutations";
import { useFileReader } from "../../../features/files/queries";
import type { FileChanges, FileContent } from "../../../features/files/type";
import { replaceModelText } from "../../../infrastructure/monaco/replaceModelText";
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
  /** ディスクの内容を反映している最中。編集として扱わない */
  isReloading: boolean;
  /** 読み直しが重なったら、最後に始めたものだけを反映する */
  latestReload: number;
};

/** beforeSave は保存の直前に呼ぶ（整形など）。失敗しても保存は続ける */
export function useEditorTabs(
  editorRef: RefObject<monaco.editor.IStandaloneCodeEditor | null>,
  beforeSave: (model: monaco.editor.ITextModel) => Promise<void>,
) {
  const beforeSaveRef = useRef(beforeSave);
  beforeSaveRef.current = beforeSave;
  const [state, dispatch] = useReducer(tabsReducer, initialTabsState);
  const [focusRequest, setFocusRequest] = useState(0);
  const readFile = useFileReader();
  const { mutateAsync: writeFile } = useSaveFileMutation();

  const buffers = useRef(new Map<string, Buffer>());
  const saveChains = useRef(new Map<string, Promise<boolean>>());
  const latestOpen = useRef(0);
  // タブを行き来してもカーソルとスクロール位置を保つ。モデルが捨てられたら一緒に消える
  const viewStates = useRef(new WeakMap<monaco.editor.ITextModel, monaco.editor.ICodeEditorViewState>());
  /** 開いた順の履歴（新しい順）。閉じたファイルも残し、Quick Open の先頭に出す */
  const history = useRef<string[]>([]);
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
    // ホットリロードで画面が作り直されると、タブは消えてもモデルは Monaco に残っている
    monaco.editor.getModel(uri)?.dispose();
    const model = monaco.editor.createModel(content.text, undefined, uri);
    const subscription = model.onDidChangeContent(() => {
      const buffer = buffers.current.get(path);
      if (!buffer || buffer.isReloading) return;
      const isDirty = model.getAlternativeVersionId() !== buffer.savedVersionId;
      dispatch({ type: "setDirty", path, isDirty });
    });
    buffers.current.set(path, {
      model,
      savedVersionId: model.getAlternativeVersionId(),
      mtimeMs: content.mtimeMs,
      hasBom: content.hasBom,
      subscription,
      isReloading: false,
      latestReload: 0,
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
      history.current = [path, ...history.current.filter((p) => p !== path)];
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
      dispatch({ type: "setDeleted", path, isDeleted: false });
      return true;
    },
    [writeFile],
  );

  /** 同じファイルの保存は直列にする。並走すると、先の保存で変わった mtime を衝突と誤認する */
  const saveFile = useCallback(
    (path: string): Promise<boolean> => {
      const previous = saveChains.current.get(path) ?? Promise.resolve(true);
      const next = previous.then(async () => {
        const buffer = buffers.current.get(path);
        if (!buffer) return false;
        // VS Code と同じく、変更がなくても保存すれば整形する（AI が書いたままのファイルも整えられる）
        await beforeSaveRef.current(buffer.model).catch((error: unknown) => console.warn(error));
        if (buffers.current.get(path) !== buffer) return false;
        const isDeleted = stateRef.current.tabs.some((tab) => tab.path === path && tab.isDeleted);
        const isClean = buffer.model.getAlternativeVersionId() === buffer.savedVersionId;
        if (isClean && !isDeleted) return true;
        return writeBuffer(path, buffer, buffer.mtimeMs);
      });
      saveChains.current.set(path, next);
      return next;
    },
    [writeBuffer],
  );

  /** 開いているファイルをディスクの内容に追従させる。未保存の編集には触らない */
  const reloadFromDisk = useCallback(
    async (path: string, buffer: Buffer) => {
      const request = ++buffer.latestReload;
      const isDirty = () => buffer.model.getAlternativeVersionId() !== buffer.savedVersionId;
      try {
        const content = await readFile(path);
        if (request !== buffer.latestReload || buffers.current.get(path) !== buffer) return;
        dispatch({ type: "setDeleted", path, isDeleted: false });
        // 未保存なら mtime も古いままにして、保存時の衝突確認に任せる
        if (isDirty()) return;
        buffer.isReloading = true;
        try {
          replaceModelText(buffer.model, content.text);
        } finally {
          buffer.isReloading = false;
        }
        buffer.savedVersionId = buffer.model.getAlternativeVersionId();
        buffer.mtimeMs = content.mtimeMs;
        buffer.hasBom = content.hasBom;
      } catch (cause) {
        if (request !== buffer.latestReload) return;
        if (isFileError(cause) && cause.kind === "notFound") {
          dispatch({ type: "setDeleted", path, isDeleted: true });
        }
        // バイナリに変わった等で読めない時は、手元の内容をそのまま残す
      }
    },
    [readFile],
  );

  const handleFileChanges = useCallback(
    ({ paths, needsRescan }: FileChanges) => {
      for (const [path, buffer] of buffers.current) {
        // フォルダごと移動されると、中のファイルのイベントは届かないことがある
        const isAffected =
          needsRescan || paths.some((changed) => path === changed || path.startsWith(`${changed}/`));
        if (isAffected) void reloadFromDisk(path, buffer);
      }
    },
    [reloadFromDisk],
  );

  /** ディスク上で名前が変わった後に呼ぶ。Monaco のモデルは URI を変えられないので作り直す */
  const handlePathRenamed = useCallback(
    (from: string, to: string) => {
      for (const [path, buffer] of [...buffers.current]) {
        if (!isWithin(path, from)) continue;
        const nextPath = rebasePath(path, from, to);
        const wasDirty = buffer.model.getAlternativeVersionId() !== buffer.savedVersionId;
        const editor = editorRef.current;
        const viewState =
          editor?.getModel() === buffer.model ? editor.saveViewState() : viewStates.current.get(buffer.model);

        createBuffer(nextPath, {
          text: buffer.model.getValue(),
          hasBom: buffer.hasBom,
          mtimeMs: buffer.mtimeMs,
        });
        const next = buffers.current.get(nextPath)!;
        // 未保存の内容は引き継ぐ。undo の履歴は新しいモデルに移せないので、保存するまで dirty のまま
        if (wasDirty) next.savedVersionId = -1;
        if (viewState) viewStates.current.set(next.model, viewState);
        // 古いモデルは、タブから消えた後の effect が捨てる
      }
      history.current = history.current.map((path) => rebasePath(path, from, to));
      dispatch({ type: "rename", from, to });
    },
    [createBuffer, editorRef],
  );

  /** 削除の確認を済ませた後に呼ぶ。中のファイルのタブも閉じる */
  const handlePathDeleted = useCallback((path: string) => {
    history.current = history.current.filter((p) => !isWithin(p, path));
    dispatch({ type: "closeWithin", path });
  }, []);

  const countUnsavedWithin = useCallback(
    (path: string) =>
      stateRef.current.tabs.filter((tab) => tab.isDirty && isWithin(tab.path, path)).length,
    [],
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
  const closeAll = useCallback(() => {
    history.current = [];
    dispatch({ type: "closeAll" });
  }, []);
  const getHistory = useCallback(() => history.current, []);

  const activeTab = state.tabs.find((tab) => tab.path === state.activePath) ?? null;

  return {
    tabs: state.tabs,
    activeTab,
    activeModel: activeTab ? (buffers.current.get(activeTab.path)?.model ?? null) : null,
    activeHasBom: activeTab ? (buffers.current.get(activeTab.path)?.hasBom ?? false) : false,
    focusRequest,
    viewStates,
    openFile,
    activate,
    pin,
    closeTab,
    closeAll,
    handleFileChanges,
    handlePathRenamed,
    handlePathDeleted,
    countUnsavedWithin,
    getHistory,
    saveActive,
    confirmDiscardAll,
  };
}
