import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { 
  GitBranch, 
  Plus, 
  ExternalLink, 
  ChevronDown,
  Monitor,
  Smartphone,
  Server,
  Box,
  Check
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

export function WorkspaceSelector({ 
  projectId, 
  currentWorkspaceId, 
  onWorkspaceChange 
}: WorkspaceSelectorProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<WorkspaceKind>("generic");
  const [newBaseBranch, setNewBaseBranch] = useState("main");
  const queryClient = useQueryClient();

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
    mutationFn: async (data: { name: string; kind: WorkspaceKind; baseBranch: string }) => {
      return apiRequest("POST", `/api/projects/${projectId}/workspaces`, data);
    },
    onSuccess: (workspace: Workspace) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "workspaces"] });
      setCreateDialogOpen(false);
      setNewName("");
      setNewKind("generic");
      onWorkspaceChange(workspace.id);
    },
  });

  const currentWorkspace = workspaces.find(ws => ws.id === currentWorkspaceId) || workspaces[0];
  const CurrentIcon = currentWorkspace ? kindIcons[currentWorkspace.kind] : Box;

  const handleOpenInNewTab = (workspace: Workspace) => {
    const url = new URL(window.location.href);
    url.searchParams.set("ws", workspace.id);
    window.open(url.toString(), "_blank");
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    createMutation.mutate({
      name: newName.trim(),
      kind: newKind,
      baseBranch: newBaseBranch,
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
              disabled={!newName.trim() || createMutation.isPending}
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
