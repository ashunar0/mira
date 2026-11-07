export type SearchMatch = {
  /** 1 始まり */
  line: number;
  /** 1 始まり */
  column: number;
  length: number;
  /** 一覧に出す行。長い行は一致した場所の周りだけ切り出してある */
  preview: string;
  previewColumn: number;
};

export type SearchFile = {
  path: string;
  matches: SearchMatch[];
};

export type SearchResults = {
  files: SearchFile[];
  /** 件数の上限で打ち切った */
  isTruncated: boolean;
};
