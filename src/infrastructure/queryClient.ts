import { focusManager, QueryClient } from "@tanstack/react-query";

// デスクトップではタブ切替の visibilitychange が起きないので、ウィンドウのフォーカスで判定する
focusManager.setEventListener((handleFocus) => {
  const onFocus = () => handleFocus(true);
  const onBlur = () => handleFocus(false);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
  };
});

// 相手はローカルの Rust なので、オフラインでも止めず、失敗を自動で再試行しない
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: "always", retry: false },
    mutations: { networkMode: "always" },
  },
});
