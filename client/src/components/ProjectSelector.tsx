import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Plus, ChevronDown, Trash2, Check, GitBranch } from "lucide-react";
import { ImportRepoModal } from "./ImportRepoModal";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import type { Project } from "@shared/schema";

interface ProjectsResponse {
  projects: Project[];
  activeProjectId: string | null;
}

interface ProjectSelectorProps {
  onProjectChange?: () => void;
}

export function ProjectSelector({ onProjectChange }: ProjectSelectorProps) {
  const queryClient = useQueryClient();
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [newProjectName, setNewProjectName] = useState("");

  const { data: projectsData } = useQuery<ProjectsResponse>({
    queryKey: ["/api/projects"],
  });

  const projects = projectsData?.projects || [];
  const activeProjectId = projectsData?.activeProjectId;
  const activeProject = projects.find((p) => p.id === activeProjectId);

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/projects", { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
      setShowNewDialog(false);
      setNewProjectName("");
      onProjectChange?.();
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/activate`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
      onProjectChange?.();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const res = await apiRequest("DELETE", `/api/projects/${projectId}`, undefined);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
      setShowDeleteDialog(false);
      setProjectToDelete(null);
      onProjectChange?.();
    },
  });

  const handleCreate = () => {
    if (newProjectName.trim()) {
      createMutation.mutate(newProjectName.trim());
    }
  };

  const handleActivate = (projectId: string) => {
    if (projectId !== activeProjectId) {
      activateMutation.mutate(projectId);
    }
  };

  const handleDelete = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    setProjectToDelete(project);
    setShowDeleteDialog(true);
  };

  const confirmDelete = () => {
    if (projectToDelete) {
      deleteMutation.mutate(projectToDelete.id);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-7 px-2 text-xs font-medium justify-start gap-1.5 w-full"
            data-testid="button-project-selector"
          >
            <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="truncate flex-1 text-left" data-testid="text-active-project-name">
              {activeProject ? activeProject.name : "No Project"}
            </span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {projects.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground text-center" data-testid="text-no-projects">
              No projects yet
            </div>
          ) : (
            projects.map((project) => (
              <DropdownMenuItem
                key={project.id}
                className="flex items-center justify-between gap-2 cursor-pointer"
                onClick={() => handleActivate(project.id)}
                data-testid={`dropdown-project-${project.id}`}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {project.id === activeProjectId ? (
                    <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                  ) : (
                    <div className="w-3.5" />
                  )}
                  <span className="truncate" data-testid={`text-project-name-${project.id}`}>{project.name}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 opacity-0 group-hover:opacity-100"
                  onClick={(e) => handleDelete(e, project)}
                  data-testid={`button-delete-project-${project.id}`}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setShowNewDialog(true)}
            className="cursor-pointer"
            data-testid="dropdown-new-project"
          >
            <Plus className="h-3.5 w-3.5 mr-2" />
            New Project
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setShowImportDialog(true)}
            className="cursor-pointer"
            data-testid="dropdown-import-repo"
          >
            <GitBranch className="h-3.5 w-3.5 mr-2" />
            Import Git Repo
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Create a new workspace for your files and code.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="project-name">Project Name</Label>
              <Input
                id="project-name"
                placeholder="My Awesome Project"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCreate();
                  }
                }}
                data-testid="input-new-project-name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowNewDialog(false)}
              data-testid="button-cancel-new-project"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newProjectName.trim() || createMutation.isPending}
              data-testid="button-create-project"
            >
              {createMutation.isPending ? "Creating..." : "Create Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{projectToDelete?.name}"? This will permanently delete all files in this project. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-project">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete-project"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImportRepoModal
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onImported={(projectId) => {
          queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
          queryClient.invalidateQueries({ queryKey: ["/api/files"] });
          onProjectChange?.();
        }}
      />
    </>
  );
}
