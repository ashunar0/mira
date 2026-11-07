import theme from "material-icon-theme/dist/material-icons.json";
import { monaco } from "../../../infrastructure/monaco/setup";

const iconUrls = import.meta.glob<string>("/node_modules/material-icon-theme/icons/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

const definitions: Record<string, { iconPath: string }> = theme.iconDefinitions;

/** VS Code と同じく、名前は大文字小文字を区別せずに照合する */
function lowerCaseKeys(map: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(map).map(([key, value]) => [key.toLowerCase(), value]));
}

const fileNames = lowerCaseKeys(theme.fileNames);
const fileExtensions = lowerCaseKeys(theme.fileExtensions);
const folderNames = lowerCaseKeys(theme.folderNames);
const folderNamesExpanded = lowerCaseKeys(theme.folderNamesExpanded);
const languageIds: Record<string, string> = theme.languageIds;

function languageIdOf(name: string): string | undefined {
  return monaco.languages
    .getLanguages()
    .find(
      (language) =>
        language.filenames?.some((filename) => filename.toLowerCase() === name) ||
        language.extensions?.some((extension) => name.endsWith(extension.toLowerCase())),
    )?.id;
}

/** VS Code と同じ優先順: ファイル名 → 拡張子（長い方から）→ 言語 → 既定 */
function resolveFileIcon(fileName: string): string {
  const name = fileName.toLowerCase();
  const byName = fileNames.get(name);
  if (byName) return byName;
  for (let dot = name.indexOf("."); dot !== -1; dot = name.indexOf(".", dot + 1)) {
    const byExtension = fileExtensions.get(name.slice(dot + 1));
    if (byExtension) return byExtension;
  }
  const language = languageIdOf(name);
  return (language && languageIds[language]) || theme.file;
}

function resolveFolderIcon(folderName: string, isOpen: boolean): string {
  const name = folderName.toLowerCase();
  return isOpen
    ? (folderNamesExpanded.get(name) ?? theme.folderExpanded)
    : (folderNames.get(name) ?? theme.folder);
}

function ThemeIcon({ iconId }: { iconId: string }) {
  const fileName = definitions[iconId].iconPath.split("/").pop();
  const src = iconUrls[`/node_modules/material-icon-theme/icons/${fileName}`];
  return <img className="wb-file-icon" src={src} alt="" width={16} height={16} draggable={false} />;
}

export function FileIcon({ name }: { name: string }) {
  return <ThemeIcon iconId={resolveFileIcon(name)} />;
}

export function FolderIcon({ name, isOpen }: { name: string; isOpen: boolean }) {
  return <ThemeIcon iconId={resolveFolderIcon(name, isOpen)} />;
}
