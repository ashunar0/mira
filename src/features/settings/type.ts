import type { ObjectTree } from "../../infrastructure/objectTree";

export type Settings = {
  /** ドット区切りの名前を入れ子に直したもの（"editor.fontSize" → { editor: { fontSize } }） */
  values: ObjectTree;
  /** "[markdown]" などの言語ごとの上書き。書いた順 */
  languageOverrides: { languages: string[]; values: ObjectTree }[];
};

/** mira の設定と、その下に敷く VS Code のユーザー設定 */
export type SettingsPaths = { mira: string | null; vscode: string | null };
export type SettingsTexts = { mira: string; vscode: string };
