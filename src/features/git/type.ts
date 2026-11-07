export type GitFileState = "modified" | "added" | "untracked" | "renamed" | "deleted" | "conflicted";

export type GitFileStatus = {
  path: string;
  state: GitFileState;
};
