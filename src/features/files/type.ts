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

export type FileErrorKind = "notFound" | "binary" | "tooLarge" | "conflict" | "io";

export type FileError = {
  kind: FileErrorKind;
  message: string;
};

export type SaveFileRequest = {
  path: string;
  text: string;
  hasBom: boolean;
  /** null なら外部変更の確認をせず上書きする */
  expectedMtimeMs: number | null;
};
