import { useEffect, useState } from "react";
import { monaco } from "../../../infrastructure/monaco/setup";

export type EditorStatus = {
  line: number;
  column: number;
  selectedChars: number;
  tabSize: number;
  insertSpaces: boolean;
  endOfLine: "LF" | "CRLF";
  languageName: string;
};

function useMarkerCounts() {
  const [counts, setCounts] = useState({ errors: 0, warnings: 0 });
  useEffect(() => {
    const subscription = monaco.editor.onDidChangeMarkers(() => {
      const markers = monaco.editor.getModelMarkers({});
      setCounts({
        errors: markers.filter((m) => m.severity === monaco.MarkerSeverity.Error).length,
        warnings: markers.filter((m) => m.severity === monaco.MarkerSeverity.Warning).length,
      });
    });
    return () => subscription.dispose();
  }, []);
  return counts;
}

type Props = {
  hasFolder: boolean;
  status: EditorStatus | null;
  hasBom: boolean;
};

export function StatusBar({ hasFolder, status, hasBom }: Props) {
  const { errors, warnings } = useMarkerCounts();

  return (
    <footer className="wb-statusbar" data-no-folder={!hasFolder}>
      <div className="wb-status-group">
        <span className="wb-status-item">
          <i className="codicon codicon-error" /> {errors}
          <i className="codicon codicon-warning" /> {warnings}
        </span>
      </div>
      {status && (
        <div className="wb-status-group">
          <span className="wb-status-item">
            Ln {status.line}, Col {status.column}
            {status.selectedChars > 0 && ` (${status.selectedChars} selected)`}
          </span>
          <span className="wb-status-item">
            {status.insertSpaces ? "Spaces" : "Tab Size"}: {status.tabSize}
          </span>
          <span className="wb-status-item">{hasBom ? "UTF-8 with BOM" : "UTF-8"}</span>
          <span className="wb-status-item">{status.endOfLine}</span>
          <span className="wb-status-item">{status.languageName}</span>
        </div>
      )}
    </footer>
  );
}
