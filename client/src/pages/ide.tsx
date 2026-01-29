import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { FileTree } from "@/components/FileTree";
import { CodeEditor } from "@/components/CodeEditor";
import { TerminalPanel, TerminalState } from "@/components/TerminalPanel";
import { AITeamPanel } from "@/components/AITeamPanel";
import { WorkspaceHeader, WorkspaceTab } from "@/components/WorkspaceHeader";
import { HeaderStatus } from "@/components/HeaderStatus";
import { FileTabsBar } from "@/components/FileTabsBar";
import { CommandPalette } from "@/components/CommandPalette";
import { useTheme } from "@/components/ThemeProvider";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sun, Moon, Monitor, FolderTree, RefreshCw, Menu, Save, FilePlus, FolderPlus, Trash2, Copy, FileEdit, Settings, Database, KeyRound, Terminal, Construction } from "lucide-react";
import { SettingsModal } from "@/components/SettingsModal";
import { AIAgentsPanel } from "@/components/AIAgentsPanel";
import { SecretsPanel } from "@/components/SecretsPanel";
import { RunTimeline } from "@/components/RunTimeline";
import { DatabasePanel } from "@/components/DatabasePanel";
import { ShellPanel } from "@/components/ShellPanel";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Task, TaskMode, Artifact, FileNode, CreateTask } from "@shared/schema";

export default function IDEPage() {
  const { theme, cycleTheme } = useTheme();
  const { toast } = useToast();
  const terminalRef = useRef<HTMLDivElement>(null);
  
  // State
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<Array<{ path: string; isDirty: boolean }>>([]);
  const [fileContent, setFileContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);
  const [goal, setGoal] = useState<string>("");
  const [logs, setLogs] = useState<string[]>([]);
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  
  // Workspace header state
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("editor");
  const [showMainHeader, setShowMainHeader] = useState(true);
  
  // Terminal state with persistence
  const [terminalState, setTerminalState] = useState<TerminalState>(() => {
    const saved = localStorage.getItem("simpleaide-terminal-state");
    return (saved as TerminalState) || "expanded";
  });
  const [terminalHeight, setTerminalHeight] = useState<number>(() => {
    const saved = localStorage.getItem("simpleaide-terminal-height");
    return saved ? parseInt(saved, 10) : 200;
  });
  
  // Dialog states
  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [dialogInput, setDialogInput] = useState("");
  const [targetFolderPath, setTargetFolderPath] = useState<string>("");
  const [pathToRename, setPathToRename] = useState<string | null>(null);
  const [pathToDelete, setPathToDelete] = useState<string | null>(null);
  
  // Persist terminal state
  useEffect(() => {
    localStorage.setItem("simpleaide-terminal-state", terminalState);
  }, [terminalState]);
  
  useEffect(() => {
    localStorage.setItem("simpleaide-terminal-height", terminalHeight.toString());
  }, [terminalHeight]);
  
  // Handle Console tab restoring terminal
  const handleTabChange = useCallback((tab: WorkspaceTab) => {
    if (tab === "console") {
      if (terminalState === "hidden") {
        setTerminalState("expanded");
      }
      setActiveTab("editor");
      setTimeout(() => {
        terminalRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    } else {
      setActiveTab(tab);
    }
  }, [terminalState]);

  // Fetch file tree
  const { data: files = [], isLoading: filesLoading, refetch: refetchFiles } = useQuery<FileNode[]>({
    queryKey: ["/api/files"],
  });

  // Fetch file content when a file is selected
  useEffect(() => {
    if (selectedFile) {
      fetch(`/api/files/content?path=${encodeURIComponent(selectedFile)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.content !== undefined) {
            setFileContent(data.content);
            setOriginalContent(data.content);
            setIsDirty(false);
          }
        })
        .catch((err) => {
          console.error("Failed to load file:", err);
          toast({
            title: "Failed to load file",
            description: err.message,
            variant: "destructive",
          });
        });
    }
  }, [selectedFile, toast]);

  // Track dirty state when content changes
  const handleContentChange = useCallback((newContent: string | undefined) => {
    if (newContent !== undefined) {
      setFileContent(newContent);
      const newIsDirty = newContent !== originalContent;
      setIsDirty(newIsDirty);
      // Sync dirty state with openFiles
      if (selectedFile) {
        setOpenFiles(prev => prev.map(f => 
          f.path === selectedFile ? { ...f, isDirty: newIsDirty } : f
        ));
      }
    }
  }, [originalContent, selectedFile]);

  // Handle file selection - add to open files if not already there
  const handleSelectFile = useCallback((path: string) => {
    setSelectedFile(path);
    setOpenFiles(prev => {
      if (prev.some(f => f.path === path)) {
        return prev;
      }
      return [...prev, { path, isDirty: false }];
    });
  }, []);

  // Handle closing a file tab
  const handleCloseFile = useCallback((path: string) => {
    setOpenFiles(prev => {
      const filtered = prev.filter(f => f.path !== path);
      // If we're closing the selected file, select the previous or next file
      if (selectedFile === path) {
        const currentIndex = prev.findIndex(f => f.path === path);
        if (filtered.length > 0) {
          const newIndex = Math.min(currentIndex, filtered.length - 1);
          setSelectedFile(filtered[newIndex].path);
        } else {
          setSelectedFile(null);
          setFileContent("");
          setOriginalContent("");
          setIsDirty(false);
        }
      }
      return filtered;
    });
  }, [selectedFile]);

  // Save file mutation
  const saveFileMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error("No file selected");
      const response = await apiRequest("PUT", "/api/fs/file", {
        path: selectedFile,
        content: fileContent,
      });
      return response.json();
    },
    onSuccess: () => {
      setOriginalContent(fileContent);
      setIsDirty(false);
      // Also clear dirty state in openFiles
      if (selectedFile) {
        setOpenFiles(prev => prev.map(f => 
          f.path === selectedFile ? { ...f, isDirty: false } : f
        ));
      }
      toast({
        title: "File saved",
        description: `${selectedFile} saved successfully.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to save file",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // New file mutation
  const newFileMutation = useMutation({
    mutationFn: async (filePath: string) => {
      const response = await apiRequest("POST", "/api/fs/new-file", { path: filePath });
      return response.json();
    },
    onSuccess: (_, filePath) => {
      refetchFiles();
      handleSelectFile(filePath);
      toast({ title: "File created", description: `${filePath} created.` });
    },
    onError: (error) => {
      toast({ title: "Failed to create file", description: error.message, variant: "destructive" });
    },
  });

  // New folder mutation
  const newFolderMutation = useMutation({
    mutationFn: async (folderPath: string) => {
      const response = await apiRequest("POST", "/api/fs/new-folder", { path: folderPath });
      return response.json();
    },
    onSuccess: () => {
      refetchFiles();
      toast({ title: "Folder created" });
    },
    onError: (error) => {
      toast({ title: "Failed to create folder", description: error.message, variant: "destructive" });
    },
  });

  // Rename mutation
  const renameMutation = useMutation({
    mutationFn: async ({ oldPath, newPath }: { oldPath: string; newPath: string }) => {
      const response = await apiRequest("POST", "/api/fs/rename", { oldPath, newPath });
      return response.json();
    },
    onSuccess: (_, { oldPath, newPath }) => {
      refetchFiles();
      // Update openFiles if renamed file was open
      setOpenFiles(prev => prev.map(f => f.path === oldPath ? { ...f, path: newPath } : f));
      if (selectedFile === oldPath) {
        setSelectedFile(newPath);
      }
      toast({ title: "Renamed successfully" });
    },
    onError: (error) => {
      toast({ title: "Failed to rename", description: error.message, variant: "destructive" });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (targetPath: string) => {
      const response = await apiRequest("POST", "/api/fs/delete", { path: targetPath });
      return response.json();
    },
    onSuccess: (_, deletedPath) => {
      refetchFiles();
      // Remove from open files and handle selection
      handleCloseFile(deletedPath);
      toast({ title: "Deleted successfully" });
    },
    onError: (error) => {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
    },
  });

  // Duplicate mutation
  const duplicateMutation = useMutation({
    mutationFn: async (sourcePath: string) => {
      const response = await apiRequest("POST", "/api/fs/duplicate", { path: sourcePath });
      return response.json();
    },
    onSuccess: (data) => {
      refetchFiles();
      if (data.newPath) {
        handleSelectFile(data.newPath);
      }
      toast({ title: "File duplicated" });
    },
    onError: (error) => {
      toast({ title: "Failed to duplicate", description: error.message, variant: "destructive" });
    },
  });

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd+S - Save
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (selectedFile && isDirty) {
          saveFileMutation.mutate();
        }
      }
      // Ctrl/Cmd+J - Toggle terminal collapse/expand
      if ((e.ctrlKey || e.metaKey) && e.key === "j") {
        e.preventDefault();
        setTerminalState(prev => {
          if (prev === "hidden") return "expanded";
          return prev === "collapsed" ? "expanded" : "collapsed";
        });
      }
      // Ctrl/Cmd+` - Show/focus terminal
      if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault();
        if (terminalState === "hidden") {
          setTerminalState("expanded");
        } else if (terminalState === "collapsed") {
          setTerminalState("expanded");
        }
        setTimeout(() => {
          terminalRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 100);
      }
      // Ctrl/Cmd+K - Command palette
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette(true);
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedFile, isDirty, saveFileMutation, terminalState]);

  // Copy path to clipboard
  const handleCopyPath = useCallback((path?: string) => {
    const pathToCopy = path || selectedFile;
    if (pathToCopy) {
      navigator.clipboard.writeText(pathToCopy);
      toast({ title: "Path copied to clipboard" });
    }
  }, [selectedFile, toast]);

  // File tree hover action handlers
  const handleNewFileInFolder = useCallback((folderPath: string) => {
    setTargetFolderPath(folderPath);
    setDialogInput(folderPath + "/");
    setShowNewFileDialog(true);
  }, []);

  const handleNewFolderInFolder = useCallback((folderPath: string) => {
    setTargetFolderPath(folderPath);
    setDialogInput(folderPath + "/");
    setShowNewFolderDialog(true);
  }, []);

  const handleRenameFromTree = useCallback((path: string) => {
    setPathToRename(path);
    setDialogInput(path);
    setShowRenameDialog(true);
  }, []);

  const handleDeleteFromTree = useCallback((path: string) => {
    setPathToDelete(path);
    setShowDeleteDialog(true);
  }, []);

  // Command palette handlers
  const handleToggleTerminal = useCallback(() => {
    setTerminalState(prev => prev === "collapsed" ? "expanded" : "collapsed");
  }, []);

  // Create task mutation
  const createTaskMutation = useMutation({
    mutationFn: async (data: CreateTask) => {
      const response = await apiRequest("POST", "/api/tasks", data);
      return response.json();
    },
    onSuccess: (task: Task) => {
      setCurrentTask(task);
      setLogs([]);
      setArtifacts([]);
      
      // Start listening to SSE for logs
      const eventSource = new EventSource(`/api/tasks/${task.id}/events`);
      
      eventSource.onmessage = (event) => {
        const data = event.data;
        if (data.trim()) {
          setLogs((prev) => [...prev, data]);
          
          if (data.includes("Task complete.")) {
            eventSource.close();
            // Fetch task and artifacts
            fetchTaskArtifacts(task.id);
          }
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        fetchTaskArtifacts(task.id);
      };
    },
    onError: (error) => {
      toast({
        title: "Failed to create task",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Fetch artifacts after task completes
  const fetchTaskArtifacts = useCallback(async (taskId: string) => {
    try {
      // Fetch task state
      const taskRes = await fetch(`/api/tasks/${taskId}`);
      const taskData = await taskRes.json();
      setCurrentTask(taskData);

      // Fetch diffs
      const diffsRes = await fetch(`/api/tasks/${taskId}/diffs`);
      const diffsData = await diffsRes.json();
      
      const newArtifacts: Artifact[] = [];
      
      for (const diffName of diffsData.diffs) {
        const artifactRes = await fetch(`/api/tasks/${taskId}/artifact?name=${encodeURIComponent(diffName)}`);
        const artifactData = await artifactRes.json();
        newArtifacts.push({
          name: diffName,
          content: artifactData.content,
          type: diffName.endsWith(".diff") ? "diff" : 
                diffName.includes("plan") ? "plan" :
                diffName.includes("review") ? "review" :
                diffName.includes("test") ? "test" : "log",
        });
      }
      
      // Also fetch plan, review, test artifacts if they exist
      const artifactTypes = ["plan.json", "review.md", "test.log"];
      for (const artName of artifactTypes) {
        try {
          const res = await fetch(`/api/tasks/${taskId}/artifact?name=${encodeURIComponent(artName)}`);
          if (res.ok) {
            const data = await res.json();
            newArtifacts.push({
              name: artName,
              content: data.content,
              type: artName.includes("plan") ? "plan" :
                    artName.includes("review") ? "review" : "test",
            });
          }
        } catch {
          // Artifact doesn't exist, skip
        }
      }
      
      setArtifacts(newArtifacts);
    } catch (err) {
      console.error("Failed to fetch artifacts:", err);
    }
  }, []);

  // Apply diff mutation
  const applyDiffMutation = useMutation({
    mutationFn: async (diffName: string) => {
      if (!currentTask) throw new Error("No current task");
      const response = await apiRequest("POST", `/api/tasks/${currentTask.id}/apply`, { diffName });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Diff applied successfully",
        description: "Changes have been applied to your files.",
      });
      refetchFiles();
      if (selectedFile) {
        // Refresh the current file content
        fetch(`/api/files/content?path=${encodeURIComponent(selectedFile)}`)
          .then((res) => res.json())
          .then((data) => {
            if (data.content !== undefined) {
              setFileContent(data.content);
            }
          });
      }
    },
    onError: (error) => {
      toast({
        title: "Failed to apply diff",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleRunTask = (mode: TaskMode, accurateMode?: boolean) => {
    createTaskMutation.mutate({
      repoPath: ".",
      goal,
      mode,
      accurateMode: accurateMode ?? false,
    });
  };

  const handleApplyDiff = (diffName: string) => {
    applyDiffMutation.mutate(diffName);
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      {showMainHeader && (
      <header className="h-7 flex items-center justify-between px-2 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded bg-primary flex items-center justify-center">
              <FolderTree className="h-2.5 w-2.5 text-primary-foreground" />
            </div>
            <span className="font-semibold text-[10px]">SimpleAide</span>
            {isDirty && <span className="text-[9px] text-muted-foreground">(unsaved)</span>}
          </div>
          
          {/* File Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-5 px-1.5 text-[10px]" data-testid="button-file-menu">
                <Menu className="h-2.5 w-2.5 mr-0.5" />
                File
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onClick={() => { setDialogInput(""); setShowNewFileDialog(true); }}
                data-testid="menu-new-file"
              >
                <FilePlus className="h-4 w-4 mr-2" />
                New File
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => { setDialogInput(""); setShowNewFolderDialog(true); }}
                data-testid="menu-new-folder"
              >
                <FolderPlus className="h-4 w-4 mr-2" />
                New Folder
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => saveFileMutation.mutate()}
                disabled={!selectedFile || !isDirty || saveFileMutation.isPending}
                data-testid="menu-save"
              >
                <Save className="h-4 w-4 mr-2" />
                Save
                <span className="ml-auto text-xs text-muted-foreground">Ctrl+S</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  if (selectedFile) {
                    setDialogInput(selectedFile);
                    setShowRenameDialog(true);
                  }
                }}
                disabled={!selectedFile}
                data-testid="menu-rename"
              >
                <FileEdit className="h-4 w-4 mr-2" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => selectedFile && duplicateMutation.mutate(selectedFile)}
                disabled={!selectedFile}
                data-testid="menu-duplicate"
              >
                <Copy className="h-4 w-4 mr-2" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleCopyPath()}
                disabled={!selectedFile}
                data-testid="menu-copy-path"
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy Path
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setShowDeleteDialog(true)}
                disabled={!selectedFile}
                className="text-destructive"
                data-testid="menu-delete"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            className="h-5 w-5 p-0"
            onClick={() => refetchFiles()}
            data-testid="button-refresh-files"
          >
            <RefreshCw className="h-2.5 w-2.5" />
          </Button>
          <Button
            variant="ghost"
            className="h-5 w-5 p-0"
            onClick={() => setShowSettingsDialog(true)}
            data-testid="button-settings"
          >
            <Settings className="h-2.5 w-2.5" />
          </Button>
          <Button
            variant="ghost"
            className="h-5 w-5 p-0"
            onClick={cycleTheme}
            data-testid="button-toggle-theme"
            title={`Theme: ${theme === "light" ? "Light" : theme === "dark" ? "Dark" : "Terminal Noir"}`}
          >
            {theme === "light" ? (
              <Sun className="h-2.5 w-2.5" />
            ) : theme === "dark" ? (
              <Moon className="h-2.5 w-2.5" />
            ) : (
              <Monitor className="h-2.5 w-2.5" />
            )}
          </Button>
        </div>
      </header>
      )}

      {/* Settings Modal */}
      <SettingsModal open={showSettingsDialog} onOpenChange={setShowSettingsDialog} />

      {/* New File Dialog */}
      <Dialog open={showNewFileDialog} onOpenChange={setShowNewFileDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New File</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="new-file-path">File path</Label>
            <Input
              id="new-file-path"
              value={dialogInput}
              onChange={(e) => setDialogInput(e.target.value)}
              placeholder="src/components/NewComponent.tsx"
              data-testid="input-new-file-path"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewFileDialog(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (dialogInput.trim()) {
                  newFileMutation.mutate(dialogInput.trim());
                  setShowNewFileDialog(false);
                }
              }}
              disabled={!dialogInput.trim()}
              data-testid="button-create-file"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Folder Dialog */}
      <Dialog open={showNewFolderDialog} onOpenChange={setShowNewFolderDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="new-folder-path">Folder path</Label>
            <Input
              id="new-folder-path"
              value={dialogInput}
              onChange={(e) => setDialogInput(e.target.value)}
              placeholder="src/new-folder"
              data-testid="input-new-folder-path"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewFolderDialog(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (dialogInput.trim()) {
                  newFolderMutation.mutate(dialogInput.trim());
                  setShowNewFolderDialog(false);
                }
              }}
              disabled={!dialogInput.trim()}
              data-testid="button-create-folder"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={showRenameDialog} onOpenChange={(open) => { setShowRenameDialog(open); if (!open) setPathToRename(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="rename-path">New path</Label>
            <Input
              id="rename-path"
              value={dialogInput}
              onChange={(e) => setDialogInput(e.target.value)}
              data-testid="input-rename-path"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowRenameDialog(false); setPathToRename(null); }}>Cancel</Button>
            <Button
              onClick={() => {
                const oldPath = pathToRename || selectedFile;
                if (oldPath && dialogInput.trim() && dialogInput !== oldPath) {
                  renameMutation.mutate({ oldPath, newPath: dialogInput.trim() });
                  setShowRenameDialog(false);
                  setPathToRename(null);
                }
              }}
              disabled={!dialogInput.trim() || dialogInput === (pathToRename || selectedFile)}
              data-testid="button-rename"
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete File</DialogTitle>
          </DialogHeader>
          <p className="py-4 text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{pathToDelete || selectedFile}</strong>? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDeleteDialog(false); setPathToDelete(null); }}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                const targetPath = pathToDelete || selectedFile;
                if (targetPath) {
                  deleteMutation.mutate(targetPath);
                  setShowDeleteDialog(false);
                  setPathToDelete(null);
                }
              }}
              data-testid="button-confirm-delete"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Command Palette */}
      <CommandPalette
        open={showCommandPalette}
        onOpenChange={setShowCommandPalette}
        files={files}
        onSelectFile={(path) => {
          handleSelectFile(path);
          setActiveTab("editor");
        }}
        onToggleTerminal={handleToggleTerminal}
        onSwitchTab={(tab) => setActiveTab(tab as WorkspaceTab)}
        onRunAction={(action) => handleRunTask(action)}
        onOpenSettings={() => setShowSettingsDialog(true)}
      />

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          {/* File Tree Panel */}
          <ResizablePanel defaultSize={15} minSize={10} maxSize={25}>
            <div className="h-full flex flex-col bg-sidebar border-r border-sidebar-border">
              <div className="px-3 py-2 border-b border-sidebar-border">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Explorer
                </span>
              </div>
              <div className="flex-1 overflow-hidden">
                <FileTree
                  files={files}
                  selectedPath={selectedFile}
                  onSelectFile={handleSelectFile}
                  onRename={handleRenameFromTree}
                  onDelete={handleDeleteFromTree}
                  onCopyPath={handleCopyPath}
                  onNewFile={handleNewFileInFolder}
                  onNewFolder={handleNewFolderInFolder}
                />
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle />

          {/* Editor + Terminal Panel */}
          <ResizablePanel defaultSize={55}>
            <div className="h-full flex flex-col">
              {/* Global Status Header */}
              <div className="flex items-center justify-end h-5 bg-background border-b border-border px-1 shrink-0">
                <HeaderStatus 
                  onNavigate={handleTabChange} 
                  showMainHeader={showMainHeader}
                  onToggleMainHeader={() => setShowMainHeader(!showMainHeader)}
                />
              </div>
              
              {/* Workspace Tabs */}
              <div className="bg-muted/30 border-b border-border shrink-0">
                <WorkspaceHeader
                  activeTab={activeTab}
                  onTabChange={handleTabChange}
                />
              </div>
              
              {/* File Tabs Bar - shown only when Editor tab is active */}
              {activeTab === "editor" && (
                <FileTabsBar
                  openFiles={openFiles}
                  selectedFile={selectedFile}
                  onSelectFile={handleSelectFile}
                  onCloseFile={handleCloseFile}
                />
              )}
              
              {/* Main Workspace Content */}
              <div className="flex-1 overflow-hidden flex flex-col">
                {activeTab === "editor" && (
                  <div className="flex-1 overflow-hidden">
                    {selectedFile ? (
                      <CodeEditor
                        value={fileContent}
                        onChange={handleContentChange}
                        path={selectedFile}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full bg-background text-muted-foreground">
                        <FolderTree className="h-16 w-16 opacity-20 mb-4" />
                        <p className="text-sm">Select a file to edit</p>
                        <p className="text-xs opacity-60 mt-1">
                          Or use the AI Team to generate code
                        </p>
                      </div>
                    )}
                  </div>
                )}
                
                {activeTab === "preview" && (
                  <div className="flex-1 flex items-center justify-center bg-background text-muted-foreground">
                    <div className="text-center">
                      <Construction className="h-12 w-12 mx-auto mb-3 opacity-30" />
                      <p className="text-sm font-medium">Preview</p>
                      <p className="text-xs opacity-60 mt-1">Live preview coming soon</p>
                    </div>
                  </div>
                )}
                
                {activeTab === "database" && (
                  <DatabasePanel />
                )}
                
                {activeTab === "secrets" && (
                  <SecretsPanel />
                )}
                
                {activeTab === "shell" && (
                  <ShellPanel />
                )}
                
                {activeTab === "developer" && (
                  <RunTimeline />
                )}
                
                {activeTab === "ai-agents" && (
                  <AIAgentsPanel />
                )}
                
                
                {/* Terminal - always visible when not hidden, on Editor tab */}
                {activeTab === "editor" && (
                  <div ref={terminalRef}>
                    <TerminalPanel
                      logs={logs}
                      onClear={handleClearLogs}
                      terminalState={terminalState}
                      onTerminalStateChange={setTerminalState}
                      terminalHeight={terminalHeight}
                      onTerminalHeightChange={setTerminalHeight}
                    />
                  </div>
                )}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle />

          {/* AI Team Panel */}
          <ResizablePanel defaultSize={30} minSize={20} maxSize={40}>
            <AITeamPanel
              goal={goal}
              onGoalChange={setGoal}
              onRunTask={handleRunTask}
              currentTask={currentTask}
              artifacts={artifacts}
              onApplyDiff={handleApplyDiff}
              isLoading={createTaskMutation.isPending}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
