import { useDeferredValue, useMemo, useState } from "react";
import { baseName } from "../../../features/files/lib/path";
import { useWorkspaceFilesQuery } from "../../../features/files/queries";
import { QuickInput, type QuickInputItem } from "../../shared/quickInput";
import { fuzzyMatch } from "../../shared/quickInput/fuzzyMatch";
import { FileIcon } from "./fileIcon";

export const COMMAND_PREFIX = ">";

// ファイル数が多くても入力が重くならないように、表示は上位だけにする
const MAX_FILE_ITEMS = 100;
// VS Code と同じく、ファイル名の一致はパス全体の一致より常に上に並べる
const LABEL_MATCH_SCORE = 1 << 16;

export type Command = {
  id: string;
  label: string;
  keybinding?: string[];
  run: () => void;
};

type Props = {
  text: string;
  rootPath: string | null;
  recentPaths: string[];
  getCommands: () => Command[];
  onTextChange: (text: string) => void;
  onOpenFile: (path: string) => void;
  onClose: () => void;
};

const normalizeQuery = (query: string) => query.normalize("NFC").replace(/\s+/g, "");

function toFileItem(path: string, rootPath: string, match?: FileMatch): QuickInputItem {
  const relative = path.slice(rootPath.length + 1).normalize("NFC");
  const label = baseName(relative);
  const description = relative.slice(0, -label.length - 1);
  return {
    id: path,
    label,
    description,
    icon: <FileIcon name={label} />,
    labelMatches: match?.labelMatches,
    descriptionMatches: match?.descriptionMatches,
  };
}

type FileMatch = {
  score: number;
  labelMatches?: number[];
  descriptionMatches?: number[];
};

function matchFile(query: string, relativePath: string): FileMatch | null {
  const normalized = relativePath.normalize("NFC");
  const label = baseName(normalized);
  const labelStart = normalized.length - label.length;

  // パス区切りを含む入力は、パス全体に対するものとして扱う
  if (!query.includes("/")) {
    const labelMatch = fuzzyMatch(query, label);
    if (labelMatch) {
      return {
        score: LABEL_MATCH_SCORE + labelMatch.score - normalized.length * 0.01,
        labelMatches: labelMatch.positions,
      };
    }
  }

  const pathMatch = fuzzyMatch(query, normalized);
  if (!pathMatch) return null;
  return {
    score: pathMatch.score - normalized.length * 0.01,
    labelMatches: pathMatch.positions.filter((p) => p >= labelStart).map((p) => p - labelStart),
    descriptionMatches: pathMatch.positions.filter((p) => p < labelStart),
  };
}

function useFileItems(query: string, rootPath: string | null, recentPaths: string[], enabled: boolean) {
  const { data: files, isPending } = useWorkspaceFilesQuery(enabled ? rootPath : null);
  const items = useMemo(() => {
    if (!enabled || !rootPath || !files) return [];
    if (!query) {
      const recent = recentPaths.filter((path) => path.startsWith(`${rootPath}/`));
      const recentSet = new Set(recent);
      const ordered = [...recent, ...files.filter((path) => !recentSet.has(path))];
      return ordered.slice(0, MAX_FILE_ITEMS).map((path) => toFileItem(path, rootPath));
    }
    const matches: { path: string; match: FileMatch }[] = [];
    for (const path of files) {
      const match = matchFile(query, path.slice(rootPath.length + 1));
      if (match) matches.push({ path, match });
    }
    return matches
      .sort((a, b) => b.match.score - a.match.score)
      .slice(0, MAX_FILE_ITEMS)
      .map(({ path, match }) => toFileItem(path, rootPath, match));
  }, [enabled, files, query, recentPaths, rootPath]);
  return { items, isPending: enabled && rootPath !== null && isPending };
}

export function QuickOpen(props: Props) {
  const { text, rootPath, recentPaths, getCommands, onTextChange, onOpenFile, onClose } = props;
  const isCommandMode = text.startsWith(COMMAND_PREFIX);
  const deferredText = useDeferredValue(text);
  const deferredIsCommandMode = deferredText.startsWith(COMMAND_PREFIX);
  const query = normalizeQuery(
    deferredIsCommandMode ? deferredText.slice(COMMAND_PREFIX.length) : deferredText,
  );

  // 開いている間は同じ一覧を使う（getCommands は描画のたびに新しくなる）
  const [commands] = useState(() =>
    getCommands().sort((a, b) => a.label.localeCompare(b.label)),
  );

  const commandItems = useMemo((): QuickInputItem[] => {
    if (!deferredIsCommandMode) return [];
    return commands
      .flatMap((command) => {
        const match = fuzzyMatch(query, command.label);
        return match ? [{ command, match }] : [];
      })
      .sort((a, b) => (query ? b.match.score - a.match.score : 0))
      .map(({ command, match }) => ({
        id: command.id,
        label: command.label,
        labelMatches: match.positions,
        keybinding: command.keybinding,
      }));
  }, [commands, deferredIsCommandMode, query]);

  const file = useFileItems(query, rootPath, recentPaths, !deferredIsCommandMode);
  const items = deferredIsCommandMode ? commandItems : file.items;

  const emptyMessage = (() => {
    if (deferredIsCommandMode) return "No matching commands";
    if (!rootPath) return "Open a folder to search for files";
    if (file.isPending) return null;
    return "No matching results";
  })();

  const handleSelect = (item: QuickInputItem) => {
    onClose();
    if (isCommandMode) {
      const command = commands.find(({ id }) => id === item.id);
      // 閉じてフォーカスが元の場所へ戻ってから実行する
      if (command) window.setTimeout(command.run, 0);
    } else {
      onOpenFile(item.id);
    }
  };

  return (
    <QuickInput
      value={text}
      placeholder={
        isCommandMode ? "Type the name of a command to run." : "Search files by name"
      }
      items={items}
      emptyMessage={emptyMessage}
      onValueChange={onTextChange}
      onSelect={handleSelect}
      onClose={onClose}
    />
  );
}
