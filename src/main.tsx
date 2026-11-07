import "@vscode/codicons/dist/codicon.css";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { Workbench } from "./components/screens/workbench";
import { queryClient } from "./infrastructure/queryClient";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Workbench />
    </QueryClientProvider>
  </React.StrictMode>,
);
