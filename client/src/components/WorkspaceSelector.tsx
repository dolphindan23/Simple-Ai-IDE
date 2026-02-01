import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { 
  GitBranch, 
  Plus, 
  ExternalLink, 
  ChevronDown,
  Monitor,
  Smartphone,
  Server,
  Box,
  Check,
  Folder
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

type WorkspaceKind = "web" | "mobile" | "backend" | "generic";

interface Workspace {
  id: string;
  name: string;
  projectId: string;
  kind: WorkspaceKind;
  rootPath: string;
  baseBranch: string;
  branch: string;
  createdAt: string;
  status: "active" | "archived";
  worktreeStatus?: {
    hasChanges: boolean;
    ahead: number;
    behind: number;
  } | null;
}

const kindIcons: Record<WorkspaceKind, typeof Monitor> = {
  web: Monitor,
  mobile: Smartphone,
  backend: Server,
  generic: Box,
};

const kindLabels: Record<WorkspaceKind, string> = {
  web: "Web/Frontend",
  mobile: "Mobile App",
  backend: "Backend/API",
  generic: "General",
};

interface WorkspaceSelectorProps {
  projectId: string | null;
  currentWorkspaceId: string | null;
  onWorkspaceChange: (workspaceId: string) => void;
}

interface Project {
  id: string;
  name: string;
}

export function WorkspaceSelector({ 
  projectId, 
  currentWorkspaceId, 
  onWorkspaceChange 
}: WorkspaceSelectorProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<WorkspaceKind>("generic");
  const [newBaseBranch, setNewBaseBranch] = useState("main");
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projectId || "");
  const [projectMode, setProjectMode] = useState<"existing" | "new">("existing");
  const [newProjectName, setNewProjectName] = useState("");
  const queryClient = useQueryClient();

  // Fetch all projects for the project selector in the create dialog
  const { data: projectsData } = useQuery<{ projects: Project[]; activeProjectId: string | null }>({
    queryKey: ["/api/projects"],
  });
  const projects = projectsData?.projects || [];

  // Reset form state when dialog opens
  useEffect(() => {
    if (createDialogOpen) {
      setProjectMode("existing");
      setNewProjectName("");
      if (projectId) {
        setSelectedProjectId(projectId);
      }
    }
  }, [createDialogOpen, projectId]);

  const { data: workspaces = [], isLoading } = useQuery<Workspace[]>({
    queryKey: ["/api/projects", projectId, "workspaces"],
    queryFn: async () => {
      if (!projectId) return [];
      const res = await fetch(`/api/projects/${projectId}/workspaces`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; kind: WorkspaceKind; baseBranch: string; targetProjectId: string }): Promise<Workspace> => {
      const res = await apiRequest("POST", `/api/projects/${data.targetProjectId}/workspaces`, {
        name: data.name,
        kind: data.kind,
        baseBranch: data.baseBranch,
      });
      return res.json();
    },
    onSuccess: (workspace: Workspace, variables) => {
      // Invalidate workspaces for the target project
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.targetProjectId, "workspaces"] });
      setCreateDialogOpen(false);
      setNewName("");
      setNewKind("generic");
      // Only switch to the new workspace if it was created in the current project
      if (variables.targetProjectId === projectId) {
        onWorkspaceChange(workspace.id);
      }
    },
  });

  const currentWorkspace = workspaces.find(ws => ws.id === currentWorkspaceId) || workspaces[0];
  const CurrentIcon = currentWorkspace ? kindIcons[currentWorkspace.kind] : Box;

  const handleOpenInNewTab = (workspace: Workspace) => {
    const url = new URL(window.location.href);
    url.searchParams.set("ws", workspace.id);
    window.open(url.toString(), "_blank");
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    
    let targetProjectId = selectedProjectId;
    
    // If creating a new project, create it first
    if (projectMode === "new") {
      if (!newProjectName.trim()) return;
      
      try {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newProjectName.trim() }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to create project");
        }
        const newProject = await res.json();
        targetProjectId = newProject.id;
        queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      } catch (error) {
        console.error("Failed to create project:", error);
        return;
      }
    } else {
      if (!selectedProjectId) return;
    }
    
    createMutation.mutate({
      name: newName.trim(),
      kind: newKind,
      baseBranch: newBaseBranch,
      targetProjectId,
    });
  };

  if (!projectId) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-7 gap-1.5 px-2"
            data-testid="button-workspace-selector"
          >
            {isLoading ? (
              <span className="text-xs text-muted-foreground">Loading...</span>
            ) : (
              <>
                <CurrentIcon className="h-3.5 w-3.5" />
                <span className="text-xs font-medium max-w-[100px] truncate">
                  {currentWorkspace?.name || "Select Workspace"}
                </span>
                {currentWorkspace?.worktreeStatus?.hasChanges && (
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                )}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {workspaces.map((workspace) => {
            const Icon = kindIcons[workspace.kind];
            const isActive = workspace.id === currentWorkspaceId;
            
            return (
              <DropdownMenuItem
                key={workspace.id}
                className="flex items-center justify-between gap-2"
                onClick={() => onWorkspaceChange(workspace.id)}
                data-testid={`menu-workspace-${workspace.id}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{workspace.name}</span>
                  {workspace.worktreeStatus?.hasChanges && (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {isActive && <Check className="h-3.5 w-3.5 text-primary" />}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenInNewTab(workspace);
                    }}
                    data-testid={`button-workspace-new-tab-${workspace.id}`}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </div>
              </DropdownMenuItem>
            );
          })}
          
          <DropdownMenuSeparator />
          
          <DropdownMenuItem
            onClick={() => setCreateDialogOpen(true)}
            data-testid="button-create-workspace"
          >
            <Plus className="h-3.5 w-3.5 mr-2" />
            New Workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Workspace</DialogTitle>
            <DialogDescription>
              Create an isolated workspace with its own git worktree. 
              Changes in this workspace won't affect other workspaces until merged.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Project</Label>
              <div className="flex gap-1 p-1 bg-muted rounded-md">
                <Button
                  type="button"
                  variant={projectMode === "existing" ? "default" : "ghost"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setProjectMode("existing")}
                  data-testid="button-project-mode-existing"
                >
                  Existing Project
                </Button>
                <Button
                  type="button"
                  variant={projectMode === "new" ? "default" : "ghost"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setProjectMode("new")}
                  data-testid="button-project-mode-new"
                >
                  New Project
                </Button>
              </div>
            </div>

            {projectMode === "existing" ? (
              <div className="space-y-2">
                <Label htmlFor="project">Select Project</Label>
                <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                  <SelectTrigger id="project" data-testid="select-workspace-project">
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        <div className="flex items-center gap-2">
                          <img src="/folder-icon.png" alt="" className="h-3.5 w-3.5 rounded-sm" />
                          {project.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="newProjectName">Project Name</Label>
                <Input
                  id="newProjectName"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="e.g., My New App"
                  data-testid="input-new-project-name"
                />
                <p className="text-xs text-muted-foreground">
                  A new project will be created with this name.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="name">Workspace Name</Label>
              <Input
                id="name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g., Mobile App, API Refactor"
                data-testid="input-workspace-name"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="kind">Type</Label>
              <Select value={newKind} onValueChange={(v) => setNewKind(v as WorkspaceKind)}>
                <SelectTrigger id="kind" data-testid="select-workspace-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(kindLabels).map(([key, label]) => {
                    const Icon = kindIcons[key as WorkspaceKind];
                    return (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5" />
                          {label}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="baseBranch">Base Branch</Label>
              <Input
                id="baseBranch"
                value={newBaseBranch}
                onChange={(e) => setNewBaseBranch(e.target.value)}
                placeholder="main"
                data-testid="input-workspace-base-branch"
              />
              <p className="text-xs text-muted-foreground">
                A new branch will be created from this base for the workspace.
              </p>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleCreate}
              disabled={
                !newName.trim() || 
                createMutation.isPending ||
                (projectMode === "existing" && !selectedProjectId) ||
                (projectMode === "new" && !newProjectName.trim())
              }
              data-testid="button-create-workspace-confirm"
            >
              {createMutation.isPending ? "Creating..." : "Create Workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
