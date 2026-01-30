import { useState, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { X, Pin, PinOff, Plus, FileText, Search, Trash2 } from "lucide-react";
import type { FileNode } from "@shared/schema";

interface ContextFile {
  path: string;
  pinned: boolean;
}

interface ContextManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: FileNode[];
  selectedFile: string | null;
  contextFiles: ContextFile[];
  onContextFilesChange: (files: ContextFile[]) => void;
}

function flattenFiles(nodes: FileNode[], result: FileNode[] = []): FileNode[] {
  for (const node of nodes) {
    if (node.type === "file") {
      result.push(node);
    }
    if (node.children) {
      flattenFiles(node.children, result);
    }
  }
  return result;
}

export function ContextManager({
  open,
  onOpenChange,
  files,
  selectedFile,
  contextFiles,
  onContextFilesChange,
}: ContextManagerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const allFiles = flattenFiles(files);
  const contextPaths = new Set(contextFiles.map(f => f.path));
  
  const filteredFiles = allFiles.filter(f => 
    !contextPaths.has(f.path) && 
    f.path.toLowerCase().includes(searchQuery.toLowerCase())
  ).slice(0, 10);

  const addFile = useCallback((path: string) => {
    if (!contextPaths.has(path)) {
      onContextFilesChange([...contextFiles, { path, pinned: false }]);
    }
    setSearchQuery("");
    setShowSearch(false);
  }, [contextFiles, contextPaths, onContextFilesChange]);

  const removeFile = useCallback((path: string) => {
    onContextFilesChange(contextFiles.filter(f => f.path !== path));
  }, [contextFiles, onContextFilesChange]);

  const togglePin = useCallback((path: string) => {
    onContextFilesChange(
      contextFiles.map(f => f.path === path ? { ...f, pinned: !f.pinned } : f)
    );
  }, [contextFiles, onContextFilesChange]);

  const addOpenFile = useCallback(() => {
    if (selectedFile && !contextPaths.has(selectedFile)) {
      onContextFilesChange([...contextFiles, { path: selectedFile, pinned: false }]);
    }
  }, [selectedFile, contextPaths, contextFiles, onContextFilesChange]);

  const clearUnpinned = useCallback(() => {
    onContextFilesChange(contextFiles.filter(f => f.pinned));
  }, [contextFiles, onContextFilesChange]);

  const totalFiles = contextFiles.length;
  const pinnedCount = contextFiles.filter(f => f.pinned).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-80 sm:w-96" data-testid="context-manager-drawer">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Context Manager
          </SheetTitle>
          <SheetDescription>
            Files the AI will see during tasks
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="secondary" data-testid="badge-context-count">
              {totalFiles} files ({pinnedCount} pinned)
            </Badge>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={addOpenFile}
                disabled={!selectedFile || contextPaths.has(selectedFile)}
                data-testid="button-add-open-file"
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Open
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSearch(!showSearch)}
                data-testid="button-search-files"
              >
                <Search className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {showSearch && (
            <div className="space-y-2">
              <Input
                placeholder="Search files to add..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="input-context-search"
                autoFocus
              />
              {filteredFiles.length > 0 && (
                <div className="border rounded-md max-h-32 overflow-y-auto">
                  {filteredFiles.map((file) => (
                    <button
                      key={file.path}
                      className="w-full px-2 py-1.5 text-xs text-left hover-elevate flex items-center gap-2"
                      onClick={() => addFile(file.path)}
                      data-testid={`context-search-result-${file.path}`}
                    >
                      <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="truncate">{file.path}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <ScrollArea className="h-[calc(100vh-280px)]">
            <div className="space-y-1">
              {contextFiles.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground" data-testid="text-no-context-files">
                  No files in context.
                  <br />
                  Add files to help the AI understand your codebase.
                </div>
              ) : (
                contextFiles.map((file) => (
                  <div
                    key={file.path}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md group bg-muted/50"
                    data-testid={`context-file-${file.path}`}
                  >
                    <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-xs truncate flex-1" title={file.path}>
                      {file.path}
                    </span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() => togglePin(file.path)}
                        data-testid={`button-toggle-pin-${file.path}`}
                      >
                        {file.pinned ? (
                          <Pin className="h-3 w-3 text-primary" />
                        ) : (
                          <PinOff className="h-3 w-3" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() => removeFile(file.path)}
                        data-testid={`button-remove-context-${file.path}`}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                    {file.pinned && (
                      <Pin className="h-3 w-3 text-primary shrink-0" />
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>

          {contextFiles.length > 0 && contextFiles.some(f => !f.pinned) && (
            <Button
              variant="outline"
              size="sm"
              onClick={clearUnpinned}
              className="w-full"
              data-testid="button-clear-unpinned"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Clear Unpinned
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
