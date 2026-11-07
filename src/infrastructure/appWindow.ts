import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function closeWindow(): Promise<void> {
  return getCurrentWindow().close();
}

/** 購読を解除する関数を返す。非同期の登録が終わる前に解除されても漏れないようにしてある */
function subscribe(register: () => Promise<() => void>): () => void {
  const unlisten = register();
  return () => {
    void unlisten.then((stop) => stop());
  };
}

export function onNativeMenu(handler: (id: string) => void): () => void {
  return subscribe(() => listen<string>("menu", (event) => handler(event.payload)));
}

/** handler が false を返すと、ウィンドウを閉じるのを取りやめる */
export function onWindowCloseRequested(handler: () => Promise<boolean>): () => void {
  return subscribe(() =>
    getCurrentWindow().onCloseRequested(async (event) => {
      if (!(await handler())) event.preventDefault();
    }),
  );
}
