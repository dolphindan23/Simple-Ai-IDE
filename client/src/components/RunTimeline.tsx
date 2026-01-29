import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  Play, 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Loader2,
  FileText,
  Code,
  TestTube2,
  MessageSquare,
  Wrench,
  ChevronRight,
  Plus,
  RotateCcw,
  Eye,
  History,
  Zap,
  Download
} from "lucide-react";
import type { TaskRun, RunMetadata, StepRun, StepType, StepStatus, RunStatus } from "@shared/schema";

interface RunTimelineProps {
  onViewArtifact?: (content: string, name: string) => void;
}

const stepTypeIcons: Record<StepType, typeof FileText> = {
  plan: FileText,
  implement: Code,
  review: MessageSquare,
  test: TestTube2,
  fix: Wrench,
};

const stepTypeLabels: Record<StepType, string> = {
  plan: "Plan",
  implement: "Implement",
  review: "Review",
  test: "Test",
  fix: "Fix",
};

const statusColors: Record<StepStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-500/20 text-blue-500 border-blue-500",
  passed: "bg-green-500/20 text-green-500 border-green-500",
  failed: "bg-red-500/20 text-red-500 border-red-500",
  skipped: "bg-yellow-500/20 text-yellow-500 border-yellow-500",
};

const runStatusColors: Record<RunStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-500/20 text-blue-500 border-blue-500",
  completed: "bg-green-500/20 text-green-500 border-green-500",
  failed: "bg-red-500/20 text-red-500 border-red-500",
  cancelled: "bg-yellow-500/20 text-yellow-500 border-yellow-500",
};

function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "passed":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "running":
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    case "pending":
      return <Clock className="h-4 w-4 text-muted-foreground" />;
    case "skipped":
      return <ChevronRight className="h-4 w-4 text-yellow-500" />;
    default:
      return <Clock className="h-4 w-4" />;
  }
}

function formatDuration(ms?: number): string {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleString();
}

export function RunTimeline({ onViewArtifact }: RunTimelineProps) {
  const { toast } = useToast();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [showNewRunDialog, setShowNewRunDialog] = useState(false);
  const [showArtifactDialog, setShowArtifactDialog] = useState(false);
  const [selectedArtifact, setSelectedArtifact] = useState<{ name: string; content: string } | null>(null);
  const [newRunGoal, setNewRunGoal] = useState("");
  const [selectedStepType, setSelectedStepType] = useState<StepType>("plan");

  // Fetch all runs
  const { data: runsData, isLoading: runsLoading, refetch: refetchRuns } = useQuery<{ runs: RunMetadata[] }>({
    queryKey: ["/api/runs"],
    refetchInterval: 5000,
  });

  // Fetch selected run details
  const { data: currentRun, isLoading: runLoading, refetch: refetchRun } = useQuery<TaskRun>({
    queryKey: ["/api/runs", selectedRunId],
    enabled: !!selectedRunId,
    refetchInterval: selectedRunId ? 2000 : false,
  });

  // Create run mutation
  const createRunMutation = useMutation({
    mutationFn: async (goal: string) => {
      const response = await apiRequest("POST", "/api/runs", { goal });
      return response.json();
    },
    onSuccess: (data: TaskRun) => {
      setSelectedRunId(data.metadata.id);
      setShowNewRunDialog(false);
      setNewRunGoal("");
      queryClient.invalidateQueries({ queryKey: ["/api/runs"] });
      toast({
        title: "Run created",
        description: `Run started for: ${data.metadata.goal.substring(0, 50)}...`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to create run",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Execute step mutation
  const executeStepMutation = useMutation({
    mutationFn: async ({ runId, stepType }: { runId: string; stepType: StepType }) => {
      const response = await apiRequest("POST", `/api/runs/${runId}/step`, { stepType });
      return response.json();
    },
    onSuccess: () => {
      refetchRun();
      toast({
        title: "Step executed",
        description: "Step completed successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Step failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Rerun mutation
  const rerunMutation = useMutation({
    mutationFn: async ({ runId, fromStep }: { runId: string; fromStep: number }) => {
      const response = await apiRequest("POST", `/api/runs/${runId}/rerun`, { fromStep });
      return response.json();
    },
    onSuccess: () => {
      refetchRun();
      toast({
        title: "Ready to rerun",
        description: "Steps after checkpoint have been cleared. Execute steps to continue.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Rerun failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Auto workflow mutation
  const autoRunMutation = useMutation({
    mutationFn: async ({ runId, skipTests = false }: { runId: string; skipTests?: boolean }) => {
      const response = await apiRequest("POST", `/api/runs/${runId}/auto`, { skipTests });
      return response.json();
    },
    onSuccess: () => {
      refetchRun();
      toast({
        title: "Auto workflow started",
        description: "Running Plan → Code → Apply → Test → Fix chain...",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Auto workflow failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Apply diff mutation
  const applyDiffMutation = useMutation({
    mutationFn: async ({ runId, stepNum }: { runId: string; stepNum: number }) => {
      const response = await apiRequest("POST", `/api/runs/${runId}/steps/${stepNum}/apply`);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Diff applied",
        description: data.backupId ? `Backup created: ${data.backupId}` : "Changes applied successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Apply failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Fetch artifact using apiRequest for consistent error handling
  const fetchArtifact = async (runId: string, stepNumber: number, artifactName: string) => {
    try {
      const response = await apiRequest("GET", `/api/runs/${runId}/steps/${stepNumber}/artifact/${artifactName}`);
      const data = await response.json();
      setSelectedArtifact({ name: data.name, content: data.content });
      setShowArtifactDialog(true);
    } catch (error: any) {
      toast({
        title: "Failed to fetch artifact",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const runs = runsData?.runs || [];

  return (
    <div className="h-full flex flex-col" data-testid="run-timeline-panel">
      <Tabs defaultValue="runs" className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-4 grid w-auto grid-cols-2">
          <TabsTrigger value="runs" data-testid="tab-runs">
            <History className="h-4 w-4 mr-2" />
            Runs
          </TabsTrigger>
          <TabsTrigger value="current" data-testid="tab-current" disabled={!selectedRunId}>
            <Play className="h-4 w-4 mr-2" />
            Current
          </TabsTrigger>
        </TabsList>

        <TabsContent value="runs" className="flex-1 flex flex-col m-0">
          <div className="p-4 border-b flex items-center justify-between gap-2">
            <h3 className="font-semibold text-sm">Workflow Runs</h3>
            <div className="flex gap-2">
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => refetchRuns()}
                data-testid="button-refresh-runs"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button 
                size="sm" 
                onClick={() => setShowNewRunDialog(true)}
                data-testid="button-new-run"
              >
                <Plus className="h-4 w-4 mr-1" />
                New Run
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-2">
              {runsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : runs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No runs yet</p>
                  <p className="text-sm mt-1">Create a run to get started</p>
                </div>
              ) : (
                runs.map((run) => (
                  <Card 
                    key={run.id}
                    className={`cursor-pointer transition-colors hover-elevate ${selectedRunId === run.id ? "border-primary" : ""}`}
                    onClick={() => setSelectedRunId(run.id)}
                    data-testid={`run-card-${run.id}`}
                  >
                    <CardHeader className="p-3 pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-sm font-medium truncate flex-1">
                          {run.goal.substring(0, 60)}{run.goal.length > 60 ? "..." : ""}
                        </CardTitle>
                        <Badge 
                          variant="outline" 
                          className={`text-xs ${runStatusColors[run.status]}`}
                        >
                          {run.status}
                        </Badge>
                      </div>
                      <CardDescription className="text-xs">
                        {formatDate(run.startedAt)} | {run.stepCount} steps
                      </CardDescription>
                    </CardHeader>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="current" className="flex-1 flex flex-col m-0">
          {currentRun ? (
            <>
              <div className="p-4 border-b">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm truncate">{currentRun.metadata.goal}</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Started: {formatDate(currentRun.metadata.startedAt)}
                    </p>
                  </div>
                  <Badge variant="outline" className={runStatusColors[currentRun.metadata.status]}>
                    {currentRun.metadata.status}
                  </Badge>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Select
                    value={selectedStepType}
                    onValueChange={(v) => setSelectedStepType(v as StepType)}
                  >
                    <SelectTrigger className="w-32" data-testid="select-step-type">
                      <SelectValue placeholder="Step type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="plan">Plan</SelectItem>
                      <SelectItem value="implement">Implement</SelectItem>
                      <SelectItem value="review">Review</SelectItem>
                      <SelectItem value="test">Test</SelectItem>
                      <SelectItem value="fix">Fix</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    onClick={() => executeStepMutation.mutate({
                      runId: currentRun.metadata.id,
                      stepType: selectedStepType,
                    })}
                    disabled={executeStepMutation.isPending || currentRun.metadata.status === "running"}
                    data-testid="button-execute-step"
                  >
                    {executeStepMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 mr-1" />
                    )}
                    Execute
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => autoRunMutation.mutate({
                      runId: currentRun.metadata.id,
                    })}
                    disabled={autoRunMutation.isPending || currentRun.metadata.status === "running"}
                    data-testid="button-auto-run"
                  >
                    {autoRunMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Zap className="h-4 w-4 mr-1" />
                    )}
                    Auto
                  </Button>
                </div>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-4">
                  <h4 className="text-sm font-medium mb-3">Steps Timeline</h4>
                  
                  {currentRun.steps.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground">
                      <Clock className="h-10 w-10 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No steps executed yet</p>
                      <p className="text-xs mt-1">Select a step type and click Execute</p>
                    </div>
                  ) : (
                    <div className="relative">
                      <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-border" />
                      
                      {currentRun.steps.map((step, index) => {
                        const StepIcon = stepTypeIcons[step.stepType];
                        return (
                          <div 
                            key={step.id} 
                            className="relative pl-12 pb-4"
                            data-testid={`step-${step.stepNumber}`}
                          >
                            <div className="absolute left-3.5 w-4 h-4 rounded-full bg-background border-2 border-muted flex items-center justify-center">
                              <StatusIcon status={step.statusMeta.status} />
                            </div>
                            
                            <Card className="hover-elevate">
                              <CardHeader className="p-3 pb-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <StepIcon className="h-4 w-4 text-muted-foreground" />
                                    <CardTitle className="text-sm font-medium">
                                      Step {step.stepNumber}: {stepTypeLabels[step.stepType]}
                                    </CardTitle>
                                  </div>
                                  <Badge 
                                    variant="outline" 
                                    className={`text-xs ${statusColors[step.statusMeta.status]}`}
                                  >
                                    {step.statusMeta.status}
                                  </Badge>
                                </div>
                              </CardHeader>
                              <CardContent className="p-3 pt-0">
                                <div className="text-xs text-muted-foreground space-y-1">
                                  <p>Duration: {formatDuration(step.statusMeta.durationMs)}</p>
                                  {step.statusMeta.errorMessage && (
                                    <p className="text-red-500">Error: {step.statusMeta.errorMessage}</p>
                                  )}
                                </div>
                                
                                {step.artifactNames.length > 0 && (
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {step.artifactNames.map((name) => (
                                      <Button
                                        key={name}
                                        size="sm"
                                        variant="outline"
                                        className="h-6 text-xs"
                                        onClick={() => fetchArtifact(currentRun.metadata.id, step.stepNumber, name)}
                                        data-testid={`artifact-${step.stepNumber}-${name}`}
                                      >
                                        <Eye className="h-3 w-3 mr-1" />
                                        {name}
                                      </Button>
                                    ))}
                                  </div>
                                )}

                                <div className="mt-2 flex flex-wrap gap-1">
                                  {(step.stepType === "implement" || step.stepType === "fix") && 
                                    step.statusMeta.status === "passed" && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6 text-xs"
                                      onClick={() => applyDiffMutation.mutate({
                                        runId: currentRun.metadata.id,
                                        stepNum: step.stepNumber,
                                      })}
                                      disabled={applyDiffMutation.isPending}
                                      data-testid={`apply-diff-${step.stepNumber}`}
                                    >
                                      <Download className="h-3 w-3 mr-1" />
                                      Apply Diff
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 text-xs"
                                    onClick={() => rerunMutation.mutate({
                                      runId: currentRun.metadata.id,
                                      fromStep: step.stepNumber,
                                    })}
                                    disabled={rerunMutation.isPending}
                                    data-testid={`rerun-from-${step.stepNumber}`}
                                  >
                                    <RotateCcw className="h-3 w-3 mr-1" />
                                    Rerun from here
                                  </Button>
                                </div>
                              </CardContent>
                            </Card>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Play className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No run selected</p>
                <p className="text-sm mt-1">Select a run from the Runs tab</p>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* New Run Dialog */}
      <Dialog open={showNewRunDialog} onOpenChange={setShowNewRunDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Run</DialogTitle>
            <DialogDescription>
              Start a new workflow run with a specific goal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="goal">Goal</Label>
              <Textarea
                id="goal"
                placeholder="Describe what you want to accomplish..."
                value={newRunGoal}
                onChange={(e) => setNewRunGoal(e.target.value)}
                className="min-h-[100px]"
                data-testid="input-run-goal"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewRunDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createRunMutation.mutate(newRunGoal)}
              disabled={!newRunGoal.trim() || createRunMutation.isPending}
              data-testid="button-confirm-new-run"
            >
              {createRunMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Create Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Artifact Viewer Dialog */}
      <Dialog open={showArtifactDialog} onOpenChange={setShowArtifactDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {selectedArtifact?.name || "Artifact"}
            </DialogTitle>
            <DialogDescription>
              View the generated artifact content from this workflow step.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <pre className="text-sm bg-muted p-4 rounded-md overflow-x-auto whitespace-pre-wrap font-mono">
              {selectedArtifact?.content || ""}
            </pre>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowArtifactDialog(false)}>
              Close
            </Button>
            {onViewArtifact && selectedArtifact && (
              <Button 
                onClick={() => {
                  onViewArtifact(selectedArtifact.content, selectedArtifact.name);
                  setShowArtifactDialog(false);
                }}
                data-testid="button-view-artifact-editor"
              >
                View Full
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
