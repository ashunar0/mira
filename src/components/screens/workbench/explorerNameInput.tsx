import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { describeFileError } from "../../../features/files/lib/fileError";
import { validateFileName } from "../../../features/files/lib/validateFileName";
import type { DirEntry } from "../../../features/files/type";

type Props = {
  initialName: string;
  siblings: DirEntry[];
  onCommit: (name: string) => Promise<void>;
  onCancel: () => void;
};

/** Explorer の行の中で名前を入力する。新規作成とリネームで共用する */
export function ExplorerNameInput({ initialName, siblings, onCommit, onCancel }: Props) {
  const [name, setName] = useState(initialName);
  const [commitError, setCommitError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isFinished = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    input?.focus();
    // リネームでは拡張子を除いた部分を選ぶ。.gitignore のような名前は全体を選ぶ
    const dot = initialName.lastIndexOf(".");
    input?.setSelectionRange(0, dot > 0 ? dot : initialName.length);
  }, [initialName]);

  const trimmedSlashes = name.replace(/\/+$/, "");
  // 空のままなのは入力の途中なので、確定しようとするまで指摘しない
  const validationError = name
    ? validateFileName(trimmedSlashes, siblings, initialName || undefined)
    : null;

  const finish = (action: () => void) => {
    if (isFinished.current) return;
    isFinished.current = true;
    action();
  };

  const commit = async () => {
    if (trimmedSlashes === initialName) return finish(onCancel);
    if (isFinished.current || validateFileName(trimmedSlashes, siblings, initialName || undefined)) {
      return;
    }
    isFinished.current = true;
    try {
      await onCommit(trimmedSlashes);
    } catch (cause) {
      isFinished.current = false;
      setCommitError(describeFileError(cause));
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    // 日本語入力の確定の Enter を、名前の確定として受け取らない
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(onCancel);
    }
  };

  // VS Code と同じく、外をクリックしたら確定する。名前が不正なら取り消す
  const handleBlur = () => {
    // 別のアプリへ切り替えただけなら、打ちかけの名前を確定しない
    if (!document.hasFocus()) return;
    if (!name || validationError || commitError) finish(onCancel);
    else void commit();
  };

  const error = validationError ?? commitError;
  return (
    <span
      className="wb-name-input"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <input
        ref={inputRef}
        value={name}
        aria-invalid={error !== null}
        aria-label="File or folder name"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(event) => {
          setName(event.target.value);
          setCommitError(null);
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
      {error && <span className="wb-name-error">{error}</span>}
    </span>
  );
}
