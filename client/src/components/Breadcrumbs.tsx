import { ChevronRight, File, Folder } from "lucide-react";

interface BreadcrumbsProps {
  path: string | null;
  onNavigate?: (path: string) => void;
}

export function Breadcrumbs({ path, onNavigate }: BreadcrumbsProps) {
  if (!path) {
    return null;
  }

  const parts = path.split("/");
  const fileName = parts.pop() || "";
  const directories = parts;

  return (
    <div
      className="flex items-center gap-0.5 px-2 py-1 text-xs text-muted-foreground overflow-x-auto bg-muted/30 border-b border-border"
      data-testid="breadcrumbs-bar"
    >
      <button
        className="hover-elevate px-1 py-0.5 rounded flex items-center gap-1"
        onClick={() => onNavigate?.("")}
        data-testid="breadcrumb-root"
      >
        <img src="/folder-icon.png" alt="" className="h-3 w-3 rounded-sm" />
        root
      </button>

      {directories.map((dir, index) => {
        const fullPath = parts.slice(0, index + 1).join("/");
        return (
          <div key={index} className="flex items-center gap-0.5">
            <ChevronRight className="h-3 w-3 shrink-0" />
            <button
              className="hover-elevate px-1 py-0.5 rounded truncate max-w-[120px]"
              onClick={() => onNavigate?.(fullPath)}
              title={dir}
              data-testid={`breadcrumb-${fullPath}`}
            >
              {dir}
            </button>
          </div>
        );
      })}

      {fileName && (
        <div className="flex items-center gap-0.5">
          <ChevronRight className="h-3 w-3 shrink-0" />
          <span
            className="px-1 py-0.5 font-medium text-foreground flex items-center gap-1"
            data-testid="breadcrumb-file"
          >
            <img src="/file-icon.png" alt="" className="h-3 w-3 rounded-sm" />
            {fileName}
          </span>
        </div>
      )}
    </div>
  );
}
