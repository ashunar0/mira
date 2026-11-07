import { FileIcon } from "./fileIcon";

export function Breadcrumbs({ rootPath, path }: { rootPath: string | null; path: string }) {
  const relative = rootPath && path.startsWith(`${rootPath}/`) ? path.slice(rootPath.length + 1) : path;
  const segments = relative.split("/").filter(Boolean);

  return (
    <div className="wb-breadcrumbs">
      {segments.map((segment, index) => {
        const isFile = index === segments.length - 1;
        return (
          <span key={`${index}-${segment}`} className="wb-breadcrumb">
            {index > 0 && <i className="codicon codicon-chevron-right" />}
            {isFile && <FileIcon name={segment} />}
            <span>{segment}</span>
          </span>
        );
      })}
    </div>
  );
}
