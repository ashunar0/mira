import type { FileError } from "../type";

export function isFileError(error: unknown): error is FileError {
  return typeof error === "object" && error !== null && "kind" in error && "message" in error;
}

export function describeFileError(error: unknown): string {
  if (isFileError(error)) return error.message;
  return error instanceof Error ? error.message : String(error);
}
