import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { FileTree } from "@/components/FileTree";
import { CodeEditor } from "@/components/CodeEditor";
import { TerminalPanel } from "@/components/TerminalPanel";
import { AITeamPanel } from "@/components/AITeamPanel";
import { useTheme } from "@/components/ThemeProvider";
import { Button } from "@/components/ui/button";
import { Sun, Moon, FolderTree, RefreshCw } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Task, TaskMode, Artifact, FileNode, CreateTask } from "@shared/schema";

export default function IDEPage() {
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  
  // State
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [goal, setGoal] = useState<string>("Add a /health endpoint and tests");
  const [logs, setLogs] = useState<string[]>([]);
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [ollamaModel, setOllamaModel] = useState("codellama");

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

  const handleRunTask = (mode: TaskMode) => {
    createTaskMutation.mutate({
      repoPath: ".",
      goal,
      mode,
    });
  };

  const handleApplyDiff = (diffName: string) => {
    applyDiffMutation.mutate(diffName);
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  const handleSettingsChange = (url: string, model: string) => {
    setOllamaUrl(url);
    setOllamaModel(model);
    // Save to localStorage for persistence
    localStorage.setItem("ollama-url", url);
    localStorage.setItem("ollama-model", model);
  };

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedUrl = localStorage.getItem("ollama-url");
    const savedModel = localStorage.getItem("ollama-model");
    if (savedUrl) setOllamaUrl(savedUrl);
    if (savedModel) setOllamaModel(savedModel);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="h-12 flex items-center justify-between px-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
              <FolderTree className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-sm">SimpleIDE</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetchFiles()}
            data-testid="button-refresh-files"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            data-testid="button-toggle-theme"
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>
        </div>
      </header>

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
                  onSelectFile={setSelectedFile}
                />
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle />

          {/* Editor + Terminal Panel */}
          <ResizablePanel defaultSize={55}>
            <ResizablePanelGroup direction="vertical">
              {/* Editor */}
              <ResizablePanel defaultSize={70}>
                <div className="h-full">
                  {selectedFile ? (
                    <CodeEditor
                      value={fileContent}
                      onChange={setFileContent}
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
              </ResizablePanel>

              <ResizableHandle />

              {/* Terminal */}
              <ResizablePanel defaultSize={30} minSize={15}>
                <TerminalPanel logs={logs} onClear={handleClearLogs} />
              </ResizablePanel>
            </ResizablePanelGroup>
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
              ollamaUrl={ollamaUrl}
              ollamaModel={ollamaModel}
              onSettingsChange={handleSettingsChange}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
