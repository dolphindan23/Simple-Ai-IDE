import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { 
  Plus, 
  ExternalLink, 
  Monitor,
  Smartphone,
  Server,
  Box,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

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

interface WorkspaceTabsProps {
  projectId: string | null;
  currentWorkspaceId: string;
  onWorkspaceChange: (workspaceId: string) => void;
}

export function WorkspaceTabs({ 
  projectId, 
  currentWorkspaceId, 
  onWorkspaceChange 
}: WorkspaceTabsProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [workspaceToDelete, setWorkspaceToDelete] = useState<Workspace | null>(null);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<WorkspaceKind>("generic");
  const [newBaseBranch, setNewBaseBranch] = useState("main");
  const queryClient = useQueryClient();
  const { toast } = useToast();

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
      const res = await fetch(`/api/projects/${projectId}/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to create workspace");
      }
      return res.json() as Promise<Workspace>;
    },
    onSuccess: (workspace) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "workspaces"] });
      setCreateDialogOpen(false);
      setNewName("");
      setNewKind("generic");
      setNewBaseBranch("main");
      onWorkspaceChange(workspace.id);
      toast({
        title: "Workspace created",
        description: `"${workspace.name}" is now active.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to create workspace",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (workspaceId: string) => {
      const res = await fetch(`/api/projects/${projectId}/workspaces/${workspaceId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to delete workspace");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "workspaces"] });
      setDeleteDialogOpen(false);
      if (workspaceToDelete && currentWorkspaceId === workspaceToDelete.id) {
        onWorkspaceChange("main");
      }
      toast({
        title: "Workspace removed",
        description: `"${workspaceToDelete?.name}" has been deleted.`,
      });
      setWorkspaceToDelete(null);
    },
    onError: (error) => {
      toast({
        title: "Failed to remove workspace",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDeleteClick = (workspace: Workspace, e: React.MouseEvent) => {
    e.stopPropagation();
    setWorkspaceToDelete(workspace);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (workspaceToDelete) {
      deleteMutation.mutate(workspaceToDelete.id);
    }
  };

  const handleOpenInNewTab = (workspace: Workspace, e: React.MouseEvent) => {
    e.stopPropagation();
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

  const allWorkspaces: Array<Workspace | { id: "main"; name: string; kind: WorkspaceKind }> = [
    { id: "main", name: "main", kind: "generic" as WorkspaceKind },
    ...workspaces.filter(ws => ws.id !== "main"),
  ];

  return (
    <>
      <div className="flex items-center h-full border-r border-border">
        {isLoading ? (
          <span className="text-xs text-muted-foreground px-2">Loading...</span>
        ) : (
          <>
            {allWorkspaces.map((workspace) => {
              const Icon = kindIcons[workspace.kind] || Box;
              const isActive = workspace.id === currentWorkspaceId;
              const fullWorkspace = "projectId" in workspace ? workspace : null;
              
              return (
                <Tooltip key={workspace.id}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onWorkspaceChange(workspace.id)}
                      className={cn(
                        "group relative flex items-center gap-1.5 h-full px-3 text-xs font-medium transition-colors border-b-2",
                        isActive 
                          ? "border-primary bg-background text-foreground" 
                          : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      )}
                      data-testid={`tab-workspace-${workspace.id}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span className="max-w-[80px] truncate">{workspace.name}</span>
                      {fullWorkspace?.worktreeStatus?.hasChanges && (
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                      )}
                      {workspace.id !== "main" && fullWorkspace && (
                        <div className="flex items-center ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => handleOpenInNewTab(fullWorkspace, e)}
                            className="p-0.5 hover:bg-muted rounded"
                            data-testid={`button-workspace-new-tab-${workspace.id}`}
                            title="Open in new tab"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </button>
                          <button
                            onClick={(e) => handleDeleteClick(fullWorkspace, e)}
                            className="p-0.5 hover:bg-destructive/20 hover:text-destructive rounded"
                            data-testid={`button-workspace-delete-${workspace.id}`}
                            title="Remove workspace"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>{workspace.name}</p>
                    {fullWorkspace && (
                      <p className="text-muted-foreground text-xs">
                        {kindLabels[fullWorkspace.kind]} • {fullWorkspace.branch}
                      </p>
                    )}
                  </TooltipContent>
                </Tooltip>
              );
            })}
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 mx-1"
                  onClick={() => setCreateDialogOpen(true)}
                  data-testid="button-create-workspace"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>New Workspace</p>
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </div>

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

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Workspace</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove "{workspaceToDelete?.name}"? 
              This will delete the workspace's worktree and all uncommitted changes will be lost.
            </DialogDescription>
          </DialogHeader>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-workspace"
            >
              {deleteMutation.isPending ? "Removing..." : "Remove Workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
