import { useState } from "react";
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, Pencil, Trash2, Copy, FilePlus, FolderPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { FileNode } from "@shared/schema";

interface FileTreeProps {
  files: FileNode[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onRename?: (path: string) => void;
  onDelete?: (path: string) => void;
  onCopyPath?: (path: string) => void;
  onNewFile?: (folderPath: string) => void;
  onNewFolder?: (folderPath: string) => void;
}

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onRename?: (path: string) => void;
  onDelete?: (path: string) => void;
  onCopyPath?: (path: string) => void;
  onNewFile?: (folderPath: string) => void;
  onNewFolder?: (folderPath: string) => void;
}

function FileTreeNode({ node, depth, selectedPath, onSelectFile, onRename, onDelete, onCopyPath, onNewFile, onNewFolder }: FileTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const [isHovered, setIsHovered] = useState(false);
  const isSelected = selectedPath === node.path;
  const isDirectory = node.type === "directory";

  const handleClick = () => {
    if (isDirectory) {
      setIsExpanded(!isExpanded);
    } else {
      onSelectFile(node.path);
    }
  };

  const handleAction = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    action();
  };

  const getFileIcon = (name: string) => {
    const ext = name.split(".").pop()?.toLowerCase();
    const iconClass = "h-4 w-4 flex-shrink-0";
    
    switch (ext) {
      case "ts":
      case "tsx":
        return <File className={cn(iconClass, "text-blue-400")} />;
      case "js":
      case "jsx":
        return <File className={cn(iconClass, "text-yellow-400")} />;
      case "py":
        return <File className={cn(iconClass, "text-green-400")} />;
      case "json":
        return <File className={cn(iconClass, "text-orange-400")} />;
      case "md":
        return <File className={cn(iconClass, "text-gray-400")} />;
      case "css":
        return <File className={cn(iconClass, "text-pink-400")} />;
      case "html":
        return <File className={cn(iconClass, "text-orange-500")} />;
      default:
        return <File className={cn(iconClass, "text-muted-foreground")} />;
    }
  };

  return (
    <div>
      <div
        data-testid={`file-tree-node-${node.path}`}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={cn(
          "group flex items-center gap-1 w-full px-2 py-1 text-sm text-left hover-elevate rounded-sm transition-colors cursor-pointer",
          isSelected && "bg-sidebar-accent text-sidebar-accent-foreground"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {isDirectory ? (
          <>
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            )}
            {isExpanded ? (
              <FolderOpen className="h-4 w-4 flex-shrink-0 text-amber-400" />
            ) : (
              <Folder className="h-4 w-4 flex-shrink-0 text-amber-400" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5" />
            {getFileIcon(node.name)}
          </>
        )}
        <span className="truncate flex-1">{node.name}</span>
        
        {/* Hover Actions */}
        <div 
          className={cn(
            "flex items-center gap-0.5 transition-opacity",
            isHovered ? "opacity-100" : "opacity-0"
          )}
        >
          {isDirectory ? (
            <>
              {onNewFile && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={(e) => handleAction(e, () => onNewFile(node.path))}
                      data-testid={`btn-new-file-${node.path}`}
                    >
                      <FilePlus className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">New File</TooltipContent>
                </Tooltip>
              )}
              {onNewFolder && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={(e) => handleAction(e, () => onNewFolder(node.path))}
                      data-testid={`btn-new-folder-${node.path}`}
                    >
                      <FolderPlus className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">New Folder</TooltipContent>
                </Tooltip>
              )}
            </>
          ) : null}
          {onRename && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={(e) => handleAction(e, () => onRename(node.path))}
                  data-testid={`btn-rename-${node.path}`}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">Rename</TooltipContent>
            </Tooltip>
          )}
          {onCopyPath && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={(e) => handleAction(e, () => onCopyPath(node.path))}
                  data-testid={`btn-copy-path-${node.path}`}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">Copy Path</TooltipContent>
            </Tooltip>
          )}
          {onDelete && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-destructive hover:text-destructive"
                  onClick={(e) => handleAction(e, () => onDelete(node.path))}
                  data-testid={`btn-delete-${node.path}`}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">Delete</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      
      {isDirectory && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              onRename={onRename}
              onDelete={onDelete}
              onCopyPath={onCopyPath}
              onNewFile={onNewFile}
              onNewFolder={onNewFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ files, selectedPath, onSelectFile, onRename, onDelete, onCopyPath, onNewFile, onNewFolder }: FileTreeProps) {
  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm p-4">
        <Folder className="h-8 w-8 mb-2 opacity-50" />
        <p>No files to display</p>
      </div>
    );
  }

  return (
    <div className="py-1 scrollbar-thin overflow-auto h-full">
      {files.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
          onRename={onRename}
          onDelete={onDelete}
          onCopyPath={onCopyPath}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
        />
      ))}
    </div>
  );
}
