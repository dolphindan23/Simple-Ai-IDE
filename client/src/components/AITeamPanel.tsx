import { useState } from "react";
import { Bot, Play, FileCode, TestTube, MessageSquare, Check, X, Loader2, ChevronDown, ChevronRight, ChevronUp, Zap, Target, Clock, Eye, Users, Activity, Minus, Package, File, FolderOpen, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { Task, TaskMode, Artifact } from "@shared/schema";
import { useAIRunEvents, type SidebarScope } from "@/hooks/useAIRunEvents";
import { AgentRoster } from "@/components/AgentRosterCard";
import { ActivityTimeline, CompactActivityFeed } from "@/components/ActivityTimeline";
import { TemplatesPanel } from "@/components/TemplatesPanel";
import { SidebarScopeSelector } from "@/components/SidebarScopeSelector";

interface AITeamPanelProps {
  goal: string;
  onGoalChange: (goal: string) => void;
  onRunTask: (mode: TaskMode, accurateMode?: boolean) => void;
  currentTask: Task | null;
  artifacts: Artifact[];
  onApplyDiff: (diffName: string) => void;
  isLoading: boolean;
  projectId?: string | null;
  workspaceId?: string | null;
  workspaceName?: string;
  onAddToContext?: (path: string) => void;
  onRemoveFromContext?: (path: string) => void;
  contextFiles?: Array<{ path: string; pinned: boolean }>;
}

function formatLatency(ms?: number): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getMiniDiffPreview(content: string): { additions: number; deletions: number; files: string[] } {
  const lines = content.split("\n");
  let additions = 0;
  let deletions = 0;
  const files: string[] = [];
  
  for (const line of lines) {
    if (line.startsWith("+++ b/") || line.startsWith("+++ ")) {
      const file = line.replace(/^\+\+\+ b?\//, "").replace(/^\+\+\+ /, "");
      if (file && !files.includes(file)) {
        files.push(file);
      }
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      additions++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions++;
    }
  }
  
  return { additions, deletions, files };
}

function ArtifactCard({ artifact, onApply }: { artifact: Artifact; onApply?: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [showFullDiff, setShowFullDiff] = useState(false);
  
  const getIcon = () => {
    switch (artifact.type) {
      case "plan":
        return <FileCode className="h-4 w-4 text-blue-400" />;
      case "diff":
        return <FileCode className="h-4 w-4 text-green-400" />;
      case "review":
        return <MessageSquare className="h-4 w-4 text-purple-400" />;
      case "test":
        return <TestTube className="h-4 w-4 text-yellow-400" />;
      default:
        return <FileCode className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getBadgeVariant = () => {
    switch (artifact.type) {
      case "plan":
        return "secondary";
      case "diff":
        return "default";
      case "review":
        return "outline";
      case "test":
        return "secondary";
      default:
        return "outline";
    }
  };

  const diffStats = artifact.type === "diff" ? getMiniDiffPreview(artifact.content) : null;

  return (
    <>
      <Card className="overflow-hidden">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <CardHeader className="p-3 cursor-pointer hover-elevate">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  {getIcon()}
                  <CardTitle className="text-sm font-medium truncate">{artifact.name}</CardTitle>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {artifact.metadata?.latencyMs && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                      <Clock className="h-3 w-3" />
                      {formatLatency(artifact.metadata.latencyMs)}
                    </span>
                  )}
                  <Badge variant={getBadgeVariant()} className="text-xs">
                    {artifact.type}
                  </Badge>
                </div>
              </div>
              {artifact.metadata?.model && (
                <div className="flex items-center gap-2 mt-1 ml-7">
                  <span className="text-[10px] text-muted-foreground">
                    {artifact.metadata.backend && `${artifact.metadata.backend} / `}{artifact.metadata.model}
                  </span>
                </div>
              )}
              {diffStats && !isOpen && (
                <div className="flex items-center gap-3 mt-1.5 ml-7">
                  <span className="text-[10px] text-green-500 font-mono">+{diffStats.additions}</span>
                  <span className="text-[10px] text-red-500 font-mono">-{diffStats.deletions}</span>
                  <span className="text-[10px] text-muted-foreground">{diffStats.files.length} file{diffStats.files.length !== 1 ? 's' : ''}</span>
                </div>
              )}
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="p-3 pt-0">
              {diffStats && (
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-green-500 font-mono">+{diffStats.additions}</span>
                    <span className="text-xs text-red-500 font-mono">-{diffStats.deletions}</span>
                    <span className="text-xs text-muted-foreground">{diffStats.files.length} file{diffStats.files.length !== 1 ? 's' : ''}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={(e) => { e.stopPropagation(); setShowFullDiff(true); }}
                    data-testid={`button-view-full-${artifact.name}`}
                  >
                    <Eye className="h-3 w-3 mr-1" />
                    View Full Diff
                  </Button>
                </div>
              )}
              <ScrollArea className="h-40">
                <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground bg-muted/50 p-2 rounded-md">
                  {artifact.content}
                </pre>
              </ScrollArea>
              {artifact.type === "diff" && onApply && (
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  onClick={onApply}
                  data-testid={`button-apply-${artifact.name}`}
                >
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  Apply Diff
                </Button>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Full Diff Dialog */}
      <Dialog open={showFullDiff} onOpenChange={setShowFullDiff}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCode className="h-5 w-5 text-green-400" />
              {artifact.name}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[60vh]">
            <pre className="text-sm font-mono whitespace-pre-wrap p-4 bg-muted/50 rounded-md">
              {artifact.content}
            </pre>
          </ScrollArea>
          {artifact.type === "diff" && onApply && (
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowFullDiff(false)}>Close</Button>
              <Button onClick={() => { onApply(); setShowFullDiff(false); }}>
                <Check className="h-4 w-4 mr-1.5" />
                Apply Diff
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AITeamPanel({
  goal,
  onGoalChange,
  onRunTask,
  currentTask,
  artifacts,
  onApplyDiff,
  isLoading,
  projectId,
  workspaceId,
  workspaceName = "Current",
  onAddToContext,
  onRemoveFromContext,
  contextFiles = [],
}: AITeamPanelProps) {
  const [accurateMode, setAccurateMode] = useState(false);
  const [agentActivityMinimized, setAgentActivityMinimized] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    
    const filePath = e.dataTransfer.getData("text/plain");
    if (filePath && onAddToContext) {
      onAddToContext(filePath);
    }
  };
  
  const getStatusBadge = () => {
    if (!currentTask) return null;
    
    switch (currentTask.status) {
      case "queued":
        return <Badge variant="secondary">Queued</Badge>;
      case "running":
        return (
          <Badge variant="default" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Running
          </Badge>
        );
      case "done":
        return (
          <Badge variant="outline" className="border-green-500 text-green-500">
            <Check className="h-3 w-3 mr-1" />
            Complete
          </Badge>
        );
      case "error":
        return (
          <Badge variant="destructive">
            <X className="h-3 w-3 mr-1" />
            Error
          </Badge>
        );
    }
  };

  return (
    <div className="flex flex-col h-full bg-sidebar">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <img src="/ai-team-icon.png" alt="AI Team" className="h-5 w-5 rounded" />
          <span className="font-semibold text-sm">AI Team</span>
        </div>
        <div className="flex items-center gap-2">
          {getStatusBadge()}
        </div>
      </div>

      {/* Responses Area - scrollable, takes remaining space */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Empty State */}
          {!currentTask && artifacts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <img src="/ai-team-icon.png" alt="AI Team" className="h-12 w-12 rounded mb-3 opacity-30" />
              <p className="text-sm text-muted-foreground">
                AI responses will appear here
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Enter a goal below and choose an action
              </p>
            </div>
          )}

          {/* Current Task Info */}
          {currentTask && (
            <Card className="bg-muted/30">
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground">Current Task</span>
                  <Badge variant="outline" className="text-xs">
                    {currentTask.mode}
                  </Badge>
                </div>
                <p className="text-sm line-clamp-2">{currentTask.goal}</p>
                {currentTask.error && (
                  <p className="text-xs text-destructive mt-2">{currentTask.error}</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Artifacts */}
          {artifacts.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Results ({artifacts.length})
              </label>
              <div className="space-y-2">
                {artifacts.map((artifact, index) => (
                  <ArtifactCard
                    key={`${artifact.name}-${index}`}
                    artifact={artifact}
                    onApply={artifact.type === "diff" ? () => onApplyDiff(artifact.name) : undefined}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input Controls - fixed at bottom */}
      <div className="border-t border-sidebar-border p-4 space-y-3 shrink-0">
        {/* Context Files Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">
                Context Files {contextFiles.length > 0 && `(${contextFiles.length})`}
              </span>
            </div>
            {contextFiles.length > 0 && onRemoveFromContext && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-destructive"
                onClick={() => contextFiles.forEach(f => onRemoveFromContext(f.path))}
                data-testid="button-clear-all-context"
              >
                Clear all
              </Button>
            )}
          </div>
          
          {contextFiles.length === 0 ? (
            <div className="flex items-center justify-center py-3 px-2 border border-dashed border-muted-foreground/30 rounded-md bg-muted/20">
              <p className="text-[10px] text-muted-foreground/70 text-center">
                Drag files here or right-click → "Add to AI Context"
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {contextFiles.map(f => {
                const fileName = f.path.split('/').pop() || f.path;
                const fileExt = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : '';
                
                return (
                  <Tooltip key={f.path}>
                    <TooltipTrigger asChild>
                      <Badge 
                        variant="secondary" 
                        className="group flex items-center gap-1 px-2 py-0.5 h-6 text-xs font-normal cursor-default"
                        data-testid={`badge-context-file-${fileName}`}
                      >
                        <File className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="truncate max-w-[100px]">{fileName}</span>
                        {f.pinned && (
                          <Pin className="h-2.5 w-2.5 text-primary shrink-0" />
                        )}
                        {onRemoveFromContext && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveFromContext(f.path);
                            }}
                            className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded-sm hover:bg-destructive/20"
                            data-testid={`button-remove-context-${fileName}`}
                          >
                            <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                          </button>
                        )}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[300px]">
                      <p className="text-xs font-mono">{f.path}</p>
                      {fileExt && <p className="text-[10px] text-muted-foreground mt-0.5">{fileExt.toUpperCase()} file</p>}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          )}
        </div>
        
        {/* Goal Input with drag-drop zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "relative rounded-md transition-all",
            isDragOver && "ring-2 ring-primary ring-offset-2 ring-offset-sidebar"
          )}
        >
          <Textarea
            value={goal}
            onChange={(e) => onGoalChange(e.target.value)}
            placeholder="Describe what you want the AI to do... (drag files here to add context)"
            className="min-h-[60px] text-sm resize-none"
            data-testid="textarea-goal"
          />
          {isDragOver && (
            <div className="absolute inset-0 bg-primary/10 rounded-md flex items-center justify-center pointer-events-none">
              <span className="text-xs font-medium text-primary">Drop to add file to context</span>
            </div>
          )}
        </div>

        {/* Mode Toggle with tooltip */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center justify-between p-2 bg-muted/30 rounded-md cursor-help">
              <div className="flex items-center gap-2">
                <Zap className={cn("h-4 w-4", !accurateMode ? "text-yellow-500" : "text-muted-foreground")} />
                <span className={cn("text-xs font-medium", !accurateMode ? "text-foreground" : "text-muted-foreground")}>
                  Fast
                </span>
              </div>
              <Switch
                checked={accurateMode}
                onCheckedChange={setAccurateMode}
                data-testid="switch-mode"
              />
              <div className="flex items-center gap-2">
                <span className={cn("text-xs font-medium", accurateMode ? "text-foreground" : "text-muted-foreground")}>
                  Accurate
                </span>
                <Target className={cn("h-4 w-4", accurateMode ? "text-primary" : "text-muted-foreground")} />
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[200px]">
            <p className="text-xs">
              <strong>Fast:</strong> Quick responses, good for iteration.<br/>
              <strong>Accurate:</strong> Thorough analysis, better quality.
            </p>
          </TooltipContent>
        </Tooltip>

        {/* Action Buttons with tooltips */}
        <div className="grid grid-cols-2 gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onRunTask("plan", accurateMode)}
                disabled={isLoading || !goal.trim()}
                className="gap-1.5"
                data-testid="button-plan"
              >
                <FileCode className="h-3.5 w-3.5" />
                Plan
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">Create a step-by-step implementation plan</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                size="sm"
                onClick={() => onRunTask("implement", accurateMode)}
                disabled={isLoading || !goal.trim()}
                className="gap-1.5"
                data-testid="button-implement"
              >
                <Play className="h-3.5 w-3.5" />
                Implement
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">Generate code changes as a reviewable diff</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onRunTask("test", accurateMode)}
                disabled={isLoading || !goal.trim()}
                className="gap-1.5"
                data-testid="button-test"
              >
                <TestTube className="h-3.5 w-3.5" />
                Test
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">Run tests or suggest test strategies</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onRunTask("review", accurateMode)}
                disabled={isLoading || !goal.trim()}
                className="gap-1.5"
                data-testid="button-review"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Review
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">Get code review feedback and suggestions</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <AgentVisibilitySection 
        isMinimized={agentActivityMinimized} 
        onToggleMinimize={() => setAgentActivityMinimized(!agentActivityMinimized)}
        projectId={projectId || null}
        workspaceId={workspaceId}
        workspaceName={workspaceName}
      />
    </div>
  );
}

interface AgentVisibilitySectionProps {
  isMinimized: boolean;
  onToggleMinimize: () => void;
  projectId: string | null;
  workspaceId?: string | null;
  workspaceName?: string;
}

function AgentVisibilitySection({ 
  isMinimized, 
  onToggleMinimize, 
  projectId, 
  workspaceId,
  workspaceName = "Current"
}: AgentVisibilitySectionProps) {
  const [sidebarScope, setSidebarScope] = useState<SidebarScope>("current");
  const { events, agentProfiles, isConnected } = useAIRunEvents({
    workspaceId,
    scope: sidebarScope
  });
  const [activeTab, setActiveTab] = useState<string>("activity");

  return (
    <div className="border-t border-sidebar-border" data-testid="agent-visibility-section">
      <div 
        className="flex items-center justify-between px-4 py-2 cursor-pointer hover-elevate"
        onClick={onToggleMinimize}
        data-testid="button-toggle-agent-activity"
      >
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Agent Activity</span>
        </div>
        <div className="flex items-center gap-2">
          <div onClick={(e) => e.stopPropagation()}>
            <SidebarScopeSelector 
              scope={sidebarScope}
              onScopeChange={setSidebarScope}
              currentWorkspaceName={workspaceName}
            />
          </div>
          <Badge 
            variant="outline" 
            className={cn(
              "text-[10px]",
              isConnected ? "bg-green-500/10 text-green-400" : "bg-yellow-500/10 text-yellow-400"
            )}
          >
            {isConnected ? "Live" : "Connecting..."}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={(e) => { e.stopPropagation(); onToggleMinimize(); }}
            data-testid="button-minimize-agent-activity"
          >
            {isMinimized ? <ChevronUp className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {!isMinimized && (
        <div className="px-4 pb-4">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="w-full grid grid-cols-3 h-8">
              <TabsTrigger value="activity" className="text-xs gap-1" data-testid="tab-activity">
                <Activity className="h-3 w-3" />
                Timeline
              </TabsTrigger>
              <TabsTrigger value="agents" className="text-xs gap-1" data-testid="tab-agents">
                <Users className="h-3 w-3" />
                Agents
              </TabsTrigger>
              <TabsTrigger value="templates" className="text-xs gap-1" data-testid="tab-templates">
                <Package className="h-3 w-3" />
                Templates
              </TabsTrigger>
            </TabsList>

            <TabsContent value="activity" className="mt-2">
              <div className="h-48 border rounded-md bg-background/50">
                <ActivityTimeline 
                  events={events} 
                  agentProfiles={agentProfiles} 
                  maxEvents={30}
                  showWorkspaceBadge={sidebarScope === "all"}
                />
              </div>
            </TabsContent>

            <TabsContent value="agents" className="mt-2">
              <div className="space-y-2">
                <AgentRoster 
                  profiles={agentProfiles} 
                  events={events} 
                  compact 
                />
                {agentProfiles.length === 0 && (
                  <div className="text-center py-4 text-muted-foreground text-sm">
                    <Users className="h-6 w-6 mx-auto mb-2 opacity-50" />
                    Loading agents...
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="templates" className="mt-2">
              <div className="h-48 border rounded-md bg-background/50">
                <TemplatesPanel projectId={projectId || null} compact />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
