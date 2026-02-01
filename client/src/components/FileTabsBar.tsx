import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface OpenFile {
  path: string;
  isDirty: boolean;
}

interface FileTabsBarProps {
  openFiles: OpenFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
}

export function FileTabsBar({ openFiles, selectedFile, onSelectFile, onCloseFile }: FileTabsBarProps) {
  if (openFiles.length === 0) {
    return null;
  }

  const getFileName = (path: string) => {
    const parts = path.split("/");
    return parts[parts.length - 1];
  };

  return (
    <div className="flex items-center h-8 bg-muted/20 border-b border-border px-1 gap-0.5 shrink-0 overflow-x-auto">
      {openFiles.map((file) => {
        const isActive = selectedFile === file.path;
        const fileName = getFileName(file.path);
        
        return (
          <div
            key={file.path}
            className={cn(
              "group flex items-center gap-1 px-2 h-6 text-xs rounded-sm transition-colors cursor-pointer min-w-0",
              "hover-elevate",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => onSelectFile(file.path)}
            data-testid={`file-tab-${file.path}`}
          >
            <span className="truncate max-w-[120px]" title={file.path}>
              {file.isDirty && <span className="text-primary mr-0.5">•</span>}
              {fileName}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseFile(file.path);
              }}
              className={cn(
                "ml-1 p-0.5 rounded-sm transition-opacity",
                "hover:bg-muted",
                isActive ? "opacity-70 hover:opacity-100" : "opacity-0 group-hover:opacity-70"
              )}
              data-testid={`file-tab-close-${file.path}`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
