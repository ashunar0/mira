import seti from "../../../assets/seti/vs-seti-icon-theme.json";
import { monaco } from "../../../infrastructure/monaco/setup";

type IconDefinition = { fontCharacter: string; fontColor?: string };

// Monaco は .tsx を typescript に含めるが、Seti は React 用の別アイコンを持つ
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".tsx": "typescriptreact",
  ".jsx": "javascriptreact",
};

const iconDefinitions: Record<string, IconDefinition> = seti.iconDefinitions;
const fileNames: Record<string, string> = seti.fileNames;
const fileExtensions: Record<string, string> = seti.fileExtensions;
const languageIds: Record<string, string> = seti.languageIds;

function languageIdOf(name: string): string | undefined {
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  if (LANGUAGE_BY_EXTENSION[extension]) return LANGUAGE_BY_EXTENSION[extension];
  return monaco.languages
    .getLanguages()
    .find(
      (language) =>
        language.filenames?.some((filename) => filename.toLowerCase() === name) ||
        language.extensions?.some((ext) => name.endsWith(ext.toLowerCase())),
    )?.id;
}

/** VS Code と同じ優先順: ファイル名 → 拡張子（長い方から）→ 言語 → 既定 */
function resolveIconId(fileName: string): string {
  const name = fileName.toLowerCase();
  if (fileNames[name]) return fileNames[name];
  for (let dot = name.indexOf("."); dot !== -1; dot = name.indexOf(".", dot + 1)) {
    const extension = fileExtensions[name.slice(dot + 1)];
    if (extension) return extension;
  }
  const language = languageIdOf(name);
  if (language && languageIds[language]) return languageIds[language];
  return seti.file;
}

export function FileIcon({ name }: { name: string }) {
  const { fontCharacter, fontColor } = iconDefinitions[resolveIconId(name)];
  const glyph = String.fromCodePoint(Number.parseInt(fontCharacter.slice(1), 16));
  return (
    <span className="wb-file-icon" style={{ color: fontColor }} aria-hidden>
      {glyph}
    </span>
  );
}
