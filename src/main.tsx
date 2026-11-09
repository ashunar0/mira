import "@vscode/codicons/dist/codicon.css";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { Workbench } from "./components/screens/workbench";
import { installSyntaxHighlighting } from "./infrastructure/monaco/syntaxHighlighting";
import { BUNDLED_THEME, applyColorTheme } from "./infrastructure/monaco/theme";
import { queryClient } from "./infrastructure/queryClient";

// 色の付け方を替えてからエディタを作る。替えられなくても、色が付かないだけで使える
void installSyntaxHighlighting()
  .catch((error: unknown) => console.error(error))
  .finally(() => {
    // 設定のテーマを読み終えるまでの色。画面が色なしで出ないよう、描く前に当てる
    applyColorTheme(BUNDLED_THEME, {});
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <QueryClientProvider client={queryClient}>
          <Workbench />
        </QueryClientProvider>
      </React.StrictMode>,
    );
  });
