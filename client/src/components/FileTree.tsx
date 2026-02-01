import { useState, useMemo } from "react";
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, Pencil, Trash2, Copy, FilePlus, FolderPlus, Search, X, BrainCircuit } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
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
  onAddToContext?: (path: string) => void;
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
  onAddToContext?: (path: string) => void;
}

function FileTreeNode({ node, depth, selectedPath, onSelectFile, onRename, onDelete, onCopyPath, onNewFile, onNewFolder, onAddToContext }: FileTreeNodeProps) {
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

  const getFileIcon = () => {
    return <img src="/file-icon.png" alt="" className="h-4 w-4 flex-shrink-0 rounded-sm" style={{ objectFit: 'cover', objectPosition: 'center' }} />;
  };

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            data-testid={`file-tree-node-${node.path}`}
            onClick={handleClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            draggable={!isDirectory}
            onDragStart={(e) => {
              if (!isDirectory) {
                e.dataTransfer.setData("text/plain", node.path);
                e.dataTransfer.effectAllowed = "copy";
              }
            }}
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
            <img src="/folder-icon.png" alt="" className="h-4 w-4 flex-shrink-0 rounded-sm" style={{ objectFit: 'cover', objectPosition: 'center' }} />
          </>
        ) : (
          <>
            <span className="w-3.5" />
            {getFileIcon()}
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
                  className="h-5 w-5 text-destructive"
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
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48" data-testid={`context-menu-${node.path}`}>
          {isDirectory && (
            <>
              {onNewFile && (
                <ContextMenuItem onClick={() => onNewFile(node.path)} data-testid={`ctx-new-file-${node.path}`}>
                  <FilePlus className="h-4 w-4 mr-2" />
                  New File
                </ContextMenuItem>
              )}
              {onNewFolder && (
                <ContextMenuItem onClick={() => onNewFolder(node.path)} data-testid={`ctx-new-folder-${node.path}`}>
                  <FolderPlus className="h-4 w-4 mr-2" />
                  New Folder
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
            </>
          )}
          {onRename && (
            <ContextMenuItem onClick={() => onRename(node.path)} data-testid={`ctx-rename-${node.path}`}>
              <Pencil className="h-4 w-4 mr-2" />
              Rename
            </ContextMenuItem>
          )}
          {onCopyPath && (
            <ContextMenuItem onClick={() => onCopyPath(node.path)} data-testid={`ctx-copy-path-${node.path}`}>
              <Copy className="h-4 w-4 mr-2" />
              Copy Path
            </ContextMenuItem>
          )}
          {onAddToContext && !isDirectory && (
            <ContextMenuItem onClick={() => onAddToContext(node.path)} data-testid={`ctx-add-context-${node.path}`}>
              <BrainCircuit className="h-4 w-4 mr-2" />
              Add to AI Context
            </ContextMenuItem>
          )}
          {onDelete && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onDelete(node.path)} className="text-destructive" data-testid={`ctx-delete-${node.path}`}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      
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
              onAddToContext={onAddToContext}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function filterFileTree(nodes: FileNode[], searchTerm: string): FileNode[] {
  if (!searchTerm.trim()) return nodes;
  
  const term = searchTerm.toLowerCase();
  
  function nodeMatches(node: FileNode): boolean {
    if (node.name.toLowerCase().includes(term)) return true;
    if (node.path.toLowerCase().includes(term)) return true;
    if (node.children) {
      return node.children.some(child => nodeMatches(child));
    }
    return false;
  }
  
  function filterNode(node: FileNode): FileNode | null {
    if (node.type === "file") {
      return node.name.toLowerCase().includes(term) || node.path.toLowerCase().includes(term) ? node : null;
    }
    
    const filteredChildren = node.children
      ?.map(child => filterNode(child))
      .filter((child): child is FileNode => child !== null);
    
    if (filteredChildren && filteredChildren.length > 0) {
      return { ...node, children: filteredChildren };
    }
    
    if (node.name.toLowerCase().includes(term)) {
      return node;
    }
    
    return null;
  }
  
  return nodes
    .map(node => filterNode(node))
    .filter((node): node is FileNode => node !== null);
}

export function FileTree({ files, selectedPath, onSelectFile, onRename, onDelete, onCopyPath, onNewFile, onNewFolder, onAddToContext }: FileTreeProps) {
  const [searchTerm, setSearchTerm] = useState("");
  
  const filteredFiles = useMemo(() => {
    return filterFileTree(files, searchTerm);
  }, [files, searchTerm]);
  
  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm p-4">
        <img src="/folder-icon.png" alt="" className="h-8 w-8 mb-2 opacity-50 rounded" />
        <p>No files to display</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-1.5 border-b border-sidebar-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search files..."
            className="h-7 pl-7 pr-7 text-xs"
            data-testid="input-search-files"
          />
          {searchTerm && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0.5 top-1/2 -translate-y-1/2 h-5 w-5"
              onClick={() => setSearchTerm("")}
              data-testid="button-clear-search"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      <div className="py-1 scrollbar-thin overflow-auto flex-1">
        {filteredFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-xs">
            <Search className="h-6 w-6 mb-2 opacity-50" />
            <p>No files match "{searchTerm}"</p>
          </div>
        ) : (
          filteredFiles.map((node) => (
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
              onAddToContext={onAddToContext}
            />
          ))
        )}
      </div>
    </div>
  );
}
