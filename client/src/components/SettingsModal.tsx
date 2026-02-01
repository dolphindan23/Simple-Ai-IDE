import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Settings, Sun, Moon, Monitor, Terminal, Code2, Shield, Bot, Plus, X, FolderKanban, Trash2, AlertTriangle, Copy, FolderOpen, Check } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import type { Settings as SettingsType } from "@shared/schema";
import { useTheme, type Theme } from "./ThemeProvider";

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { toast } = useToast();
  const { setTheme } = useTheme();
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; name: string } | null>(null);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  const { data: savedSettings, isLoading } = useQuery<SettingsType>({
    queryKey: ["/api/settings"],
    enabled: open,
  });

  const { data: activeProjectData } = useQuery<{ project: { id: string; name: string } | null }>({
    queryKey: ["/api/projects/active"],
    enabled: open,
  });
  const activeProject = activeProjectData?.project ?? null;

  const { data: projectsData } = useQuery<{ projects: Array<{ id: string; name: string; createdAt?: string }>; activeProjectId: string | null }>({
    queryKey: ["/api/projects"],
    enabled: open,
  });
  const allProjects = projectsData?.projects ?? [];

  const deleteProjectMutation = useMutation({
    mutationFn: async (projectId: string) => {
      return apiRequest("DELETE", `/api/projects/${projectId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects/active"] });
      toast({ title: "Project deleted", description: "The project has been permanently removed." });
      setShowDeleteConfirm(false);
      setDeleteConfirmed(false);
      setProjectToDelete(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const duplicateProjectMutation = useMutation({
    mutationFn: async ({ projectId, name }: { projectId: string; name?: string }) => {
      return apiRequest("POST", `/api/projects/${projectId}/duplicate`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project duplicated", description: "A copy of the project has been created." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const activateProjectMutation = useMutation({
    mutationFn: async (projectId: string) => {
      return apiRequest("POST", `/api/projects/${projectId}/activate`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects/active"] });
      toast({ title: "Project opened", description: "Switched to the selected project." });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createProjectMutation = useMutation({
    mutationFn: async (name: string) => {
      return apiRequest("POST", "/api/projects", { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects/active"] });
      toast({ title: "Project created", description: "Your new project is ready." });
      setShowCreateProject(false);
      setNewProjectName("");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (savedSettings) {
      setSettings(savedSettings);
    }
  }, [savedSettings]);

  const saveMutation = useMutation({
    mutationFn: async (newSettings: SettingsType) => {
      return apiRequest("PUT", "/api/settings", newSettings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      if (settings?.general.theme && settings.general.theme !== "system") {
        setTheme(settings.general.theme as Theme);
      } else if (settings?.general.theme === "system") {
        const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        setTheme(systemTheme as Theme);
      }
      toast({ title: "Settings saved", description: "Your preferences have been updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    if (settings) {
      saveMutation.mutate(settings);
    }
  };

  if (!settings) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto" data-testid="dialog-settings">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Settings
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="general" className="mt-4">
          <TabsList className="grid w-full grid-cols-5" data-testid="settings-tabs">
            <TabsTrigger value="general" className="flex items-center gap-1" data-testid="tab-general">
              <Monitor className="w-4 h-4" />
              General
            </TabsTrigger>
            <TabsTrigger value="editor" className="flex items-center gap-1" data-testid="tab-editor">
              <Code2 className="w-4 h-4" />
              Editor
            </TabsTrigger>
            <TabsTrigger value="ai" className="flex items-center gap-1" data-testid="tab-ai">
              <Bot className="w-4 h-4" />
              AI
            </TabsTrigger>
            <TabsTrigger value="trust" className="flex items-center gap-1" data-testid="tab-trust">
              <Shield className="w-4 h-4" />
              Trust
            </TabsTrigger>
            <TabsTrigger value="project" className="flex items-center gap-1" data-testid="tab-project">
              <FolderKanban className="w-4 h-4" />
              Project
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4 mt-4" data-testid="panel-general">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Theme</Label>
                  <p className="text-sm text-muted-foreground">Choose your preferred color theme</p>
                </div>
                <Select
                  value={settings.general.theme}
                  onValueChange={(value) => setSettings({
                    ...settings,
                    general: { ...settings.general, theme: value as "light" | "dark" | "terminal-noir" | "system" }
                  })}
                >
                  <SelectTrigger className="w-[160px]" data-testid="select-theme">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light"><div className="flex items-center gap-2"><Sun className="w-4 h-4" /> Light</div></SelectItem>
                    <SelectItem value="dark"><div className="flex items-center gap-2"><Moon className="w-4 h-4" /> Dark</div></SelectItem>
                    <SelectItem value="terminal-noir"><div className="flex items-center gap-2"><Terminal className="w-4 h-4" /> Terminal Noir</div></SelectItem>
                    <SelectItem value="system"><div className="flex items-center gap-2"><Monitor className="w-4 h-4" /> System</div></SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Show Hidden Files</Label>
                  <p className="text-sm text-muted-foreground">Display files starting with a dot</p>
                </div>
                <Switch
                  checked={settings.general.showHiddenFiles}
                  onCheckedChange={(checked) => setSettings({
                    ...settings,
                    general: { ...settings.general, showHiddenFiles: checked }
                  })}
                  data-testid="switch-hidden-files"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Auto-Save Delay</Label>
                    <p className="text-sm text-muted-foreground">Time in ms before auto-saving</p>
                  </div>
                  <span className="text-sm font-mono">{settings.general.autoSaveDelay}ms</span>
                </div>
                <Slider
                  value={[settings.general.autoSaveDelay]}
                  onValueChange={([value]) => setSettings({
                    ...settings,
                    general: { ...settings.general, autoSaveDelay: value }
                  })}
                  min={500}
                  max={10000}
                  step={500}
                  data-testid="slider-autosave-delay"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="editor" className="space-y-4 mt-4" data-testid="panel-editor">
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Font Size</Label>
                    <p className="text-sm text-muted-foreground">Editor font size in pixels</p>
                  </div>
                  <span className="text-sm font-mono">{settings.editor.fontSize}px</span>
                </div>
                <Slider
                  value={[settings.editor.fontSize]}
                  onValueChange={([value]) => setSettings({
                    ...settings,
                    editor: { ...settings.editor, fontSize: value }
                  })}
                  min={8}
                  max={32}
                  step={1}
                  data-testid="slider-font-size"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Tab Size</Label>
                    <p className="text-sm text-muted-foreground">Number of spaces per tab</p>
                  </div>
                  <span className="text-sm font-mono">{settings.editor.tabSize}</span>
                </div>
                <Slider
                  value={[settings.editor.tabSize]}
                  onValueChange={([value]) => setSettings({
                    ...settings,
                    editor: { ...settings.editor, tabSize: value }
                  })}
                  min={1}
                  max={8}
                  step={1}
                  data-testid="slider-tab-size"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Word Wrap</Label>
                  <p className="text-sm text-muted-foreground">How to wrap long lines</p>
                </div>
                <Select
                  value={settings.editor.wordWrap}
                  onValueChange={(value) => setSettings({
                    ...settings,
                    editor: { ...settings.editor, wordWrap: value as any }
                  })}
                >
                  <SelectTrigger className="w-[140px]" data-testid="select-word-wrap">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on">On</SelectItem>
                    <SelectItem value="off">Off</SelectItem>
                    <SelectItem value="bounded">Bounded</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Line Numbers</Label>
                  <p className="text-sm text-muted-foreground">How to display line numbers</p>
                </div>
                <Select
                  value={settings.editor.lineNumbers}
                  onValueChange={(value) => setSettings({
                    ...settings,
                    editor: { ...settings.editor, lineNumbers: value as any }
                  })}
                >
                  <SelectTrigger className="w-[140px]" data-testid="select-line-numbers">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on">On</SelectItem>
                    <SelectItem value="off">Off</SelectItem>
                    <SelectItem value="relative">Relative</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Minimap</Label>
                  <p className="text-sm text-muted-foreground">Show code minimap on the right</p>
                </div>
                <Switch
                  checked={settings.editor.minimap}
                  onCheckedChange={(checked) => setSettings({
                    ...settings,
                    editor: { ...settings.editor, minimap: checked }
                  })}
                  data-testid="switch-minimap"
                />
              </div>

              <div className="space-y-2">
                <Label>Font Family</Label>
                <Input
                  value={settings.editor.fontFamily}
                  onChange={(e) => setSettings({
                    ...settings,
                    editor: { ...settings.editor, fontFamily: e.target.value }
                  })}
                  placeholder="JetBrains Mono, monospace"
                  data-testid="input-font-family"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="ai" className="space-y-4 mt-4" data-testid="panel-ai">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Default Action</Label>
                  <p className="text-sm text-muted-foreground">Default AI task mode</p>
                </div>
                <Select
                  value={settings.ai?.defaultAction ?? "plan"}
                  onValueChange={(value) => setSettings({
                    ...settings,
                    ai: { ...settings.ai, defaultAction: value as any }
                  })}
                >
                  <SelectTrigger className="w-[140px]" data-testid="select-default-action">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="plan">Plan</SelectItem>
                    <SelectItem value="implement">Implement</SelectItem>
                    <SelectItem value="test">Test</SelectItem>
                    <SelectItem value="review">Review</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Default Speed</Label>
                  <p className="text-sm text-muted-foreground">Fast uses smaller models, Accurate uses larger</p>
                </div>
                <Select
                  value={settings.ai?.defaultSpeed ?? "fast"}
                  onValueChange={(value) => setSettings({
                    ...settings,
                    ai: { ...settings.ai, defaultSpeed: value as any }
                  })}
                >
                  <SelectTrigger className="w-[140px]" data-testid="select-default-speed">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fast">Fast</SelectItem>
                    <SelectItem value="accurate">Accurate</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Show Diff Before Apply</Label>
                  <p className="text-sm text-muted-foreground">Review changes before applying them</p>
                </div>
                <Switch
                  checked={settings.ai?.showDiffBeforeApply ?? true}
                  onCheckedChange={(checked) => setSettings({
                    ...settings,
                    ai: { ...settings.ai, showDiffBeforeApply: checked }
                  })}
                  data-testid="switch-show-diff"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Confirm Destructive Changes</Label>
                  <p className="text-sm text-muted-foreground">Require confirmation for file deletions</p>
                </div>
                <Switch
                  checked={settings.ai?.confirmDestructiveChanges ?? true}
                  onCheckedChange={(checked) => setSettings({
                    ...settings,
                    ai: { ...settings.ai, confirmDestructiveChanges: checked }
                  })}
                  data-testid="switch-confirm-destructive"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="trust" className="space-y-4 mt-4" data-testid="panel-trust">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Auto-Fix Enabled</Label>
                  <p className="text-sm text-muted-foreground">Allow AI to automatically retry failed tests</p>
                </div>
                <Switch
                  checked={settings.trust?.autoFixEnabled ?? false}
                  onCheckedChange={(checked) => setSettings({
                    ...settings,
                    trust: { ...settings.trust!, autoFixEnabled: checked }
                  })}
                  data-testid="switch-auto-fix"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Max Fix Attempts</Label>
                    <p className="text-sm text-muted-foreground">Maximum retry attempts for TestFixer</p>
                  </div>
                  <span className="text-sm font-mono">{settings.trust?.maxFixAttempts ?? 3}</span>
                </div>
                <Slider
                  value={[settings.trust?.maxFixAttempts ?? 3]}
                  onValueChange={([value]) => setSettings({
                    ...settings,
                    trust: { ...settings.trust!, maxFixAttempts: value }
                  })}
                  min={1}
                  max={10}
                  step={1}
                  disabled={!settings.trust?.autoFixEnabled}
                  data-testid="slider-max-fix-attempts"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Max Files Per Patch</Label>
                    <p className="text-sm text-muted-foreground">Maximum files that can be modified</p>
                  </div>
                  <span className="text-sm font-mono">{settings.trust?.maxFilesPerPatch ?? 10}</span>
                </div>
                <Slider
                  value={[settings.trust?.maxFilesPerPatch ?? 10]}
                  onValueChange={([value]) => setSettings({
                    ...settings,
                    trust: { ...settings.trust!, maxFilesPerPatch: value }
                  })}
                  min={1}
                  max={50}
                  step={1}
                  data-testid="slider-max-files"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Max Lines Per Patch</Label>
                    <p className="text-sm text-muted-foreground">Maximum total line changes allowed</p>
                  </div>
                  <span className="text-sm font-mono">{settings.trust?.maxLinesPerPatch ?? 500}</span>
                </div>
                <Slider
                  value={[settings.trust?.maxLinesPerPatch ?? 500]}
                  onValueChange={([value]) => setSettings({
                    ...settings,
                    trust: { ...settings.trust!, maxLinesPerPatch: value }
                  })}
                  min={50}
                  max={2000}
                  step={50}
                  data-testid="slider-max-lines"
                />
              </div>

              <div className="space-y-2">
                <Label>Sensitive Paths</Label>
                <p className="text-sm text-muted-foreground mb-2">Glob patterns for paths requiring confirmation</p>
                <Textarea
                  value={(settings.trust?.sensitivePaths ?? []).join("\n")}
                  onChange={(e) => setSettings({
                    ...settings,
                    trust: { 
                      ...settings.trust!, 
                      sensitivePaths: e.target.value.split("\n").filter(p => p.trim()) 
                    }
                  })}
                  placeholder="server/**&#10;scripts/**&#10;.env*"
                  className="font-mono text-xs min-h-[80px]"
                  data-testid="textarea-sensitive-paths"
                />
              </div>

              <div className="space-y-2">
                <Label>Verify Command Allowlist</Label>
                <p className="text-sm text-muted-foreground mb-2">Commands allowed for verification (plus package.json scripts)</p>
                <Textarea
                  value={(settings.trust?.verifyAllowlist ?? []).join("\n")}
                  onChange={(e) => setSettings({
                    ...settings,
                    trust: { 
                      ...settings.trust!, 
                      verifyAllowlist: e.target.value.split("\n").filter(c => c.trim()) 
                    }
                  })}
                  placeholder="npm test&#10;npm run lint&#10;tsc --noEmit"
                  className="font-mono text-xs min-h-[80px]"
                  data-testid="textarea-verify-allowlist"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="project" className="space-y-4 mt-4" data-testid="panel-project">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-medium">All Projects</Label>
                <Button 
                  size="sm" 
                  onClick={() => {
                    setNewProjectName("");
                    setShowCreateProject(true);
                  }}
                  data-testid="button-new-project"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  New Project
                </Button>
              </div>

              <ScrollArea className="h-[280px] rounded-md border">
                <div className="p-2 space-y-1">
                  {allProjects && allProjects.length > 0 ? (
                    allProjects.map((project) => {
                      const isActive = activeProject?.id === project.id;
                      return (
                        <div
                          key={project.id}
                          className={`flex items-center gap-2 p-2 rounded-md group ${isActive ? 'bg-primary/10 border border-primary/30' : 'hover-elevate'}`}
                          data-testid={`project-item-${project.id}`}
                        >
                          <FolderKanban className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">{project.name}</span>
                              {isActive && (
                                <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">Active</span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground font-mono truncate">{project.id}</p>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {!isActive && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => activateProjectMutation.mutate(project.id)}
                                disabled={activateProjectMutation.isPending}
                                data-testid={`button-open-${project.id}`}
                              >
                                <FolderOpen className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => duplicateProjectMutation.mutate({ projectId: project.id })}
                              disabled={duplicateProjectMutation.isPending}
                              data-testid={`button-copy-${project.id}`}
                            >
                              <Copy className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              onClick={() => {
                                setProjectToDelete({ id: project.id, name: project.name });
                                setDeleteConfirmed(false);
                                setShowDeleteConfirm(true);
                              }}
                              data-testid={`button-delete-${project.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <FolderKanban className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p>No projects yet</p>
                      <p className="text-sm">Create your first project to get started</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </TabsContent>
        </Tabs>

        <AlertDialog open={showDeleteConfirm} onOpenChange={(open) => {
          setShowDeleteConfirm(open);
          if (!open) {
            setDeleteConfirmed(false);
            setProjectToDelete(null);
          }
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-5 h-5" />
                Delete Project?
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>
                    This will permanently delete <strong>{projectToDelete?.name}</strong> and all its contents including files, workspaces, and settings.
                  </p>
                  <div className="flex items-start gap-2 p-3 bg-destructive/10 rounded-md border border-destructive/20">
                    <Checkbox
                      id="confirm-delete"
                      checked={deleteConfirmed}
                      onCheckedChange={(checked) => setDeleteConfirmed(checked === true)}
                      data-testid="checkbox-delete-confirm"
                    />
                    <label htmlFor="confirm-delete" className="text-sm cursor-pointer leading-tight">
                      I understand this action is permanent and cannot be undone
                    </label>
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-delete">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => projectToDelete && deleteProjectMutation.mutate(projectToDelete.id)}
                disabled={!projectToDelete || !deleteConfirmed || deleteProjectMutation.isPending}
                className="bg-destructive text-destructive-foreground"
                data-testid="button-confirm-delete"
              >
                {deleteProjectMutation.isPending ? "Deleting..." : "Delete Project"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={showCreateProject} onOpenChange={(open) => {
          setShowCreateProject(open);
          if (!open) {
            setNewProjectName("");
          }
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <FolderKanban className="w-5 h-5" />
                Create New Project
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>Enter a name for your new project.</p>
                  <Input
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="My Project"
                    data-testid="input-new-project-name"
                  />
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-create">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => newProjectName.trim() && createProjectMutation.mutate(newProjectName.trim())}
                disabled={!newProjectName.trim() || createProjectMutation.isPending}
                data-testid="button-confirm-create"
              >
                {createProjectMutation.isPending ? "Creating..." : "Create Project"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-settings">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-settings">
            {saveMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
