export type DirEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
};

export type FileContent = {
  text: string;
  hasBom: boolean;
  mtimeMs: number;
};

export type FileErrorKind = "notFound" | "alreadyExists" | "binary" | "tooLarge" | "conflict" | "io";

export type FileError = {
  kind: FileErrorKind;
  message: string;
};

export type FileChanges = {
  paths: string[];
  /** OS がイベントを取りこぼした。paths は当てにせず全体を読み直す */
  needsRescan: boolean;
  /** コミットやステージなどで Git の状態が変わった */
  gitChanged: boolean;
};

export type SaveFileRequest = {
  path: string;
  text: string;
  hasBom: boolean;
  /** null なら外部変更の確認をせず上書きする */
  expectedMtimeMs: number | null;
};
