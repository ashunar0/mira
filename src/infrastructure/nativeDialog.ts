import { ask, message, open } from "@tauri-apps/plugin-dialog";

export async function pickFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

export type SaveChoice = "save" | "discard" | "cancel";

export async function askSaveChoice(text: string, saveLabel: string): Promise<SaveChoice> {
  const discardLabel = "Don't Save";
  const result = await message(text, {
    kind: "warning",
    buttons: { yes: saveLabel, no: discardLabel, cancel: "Cancel" },
  });
  if (result === saveLabel || result === "Yes") return "save";
  if (result === discardLabel || result === "No") return "discard";
  return "cancel";
}

export function askOverwrite(text: string): Promise<boolean> {
  return ask(text, { kind: "warning", okLabel: "Overwrite", cancelLabel: "Cancel" });
}

export async function showError(text: string): Promise<void> {
  await message(text, { kind: "error" });
}
