import { useState } from "react";
import { Bot, Play, FileCode, TestTube, MessageSquare, Check, X, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { Task, TaskMode, Artifact } from "@shared/schema";

interface AITeamPanelProps {
  goal: string;
  onGoalChange: (goal: string) => void;
  onRunTask: (mode: TaskMode) => void;
  currentTask: Task | null;
  artifacts: Artifact[];
  onApplyDiff: (diffName: string) => void;
  isLoading: boolean;
}

function ArtifactCard({ artifact, onApply }: { artifact: Artifact; onApply?: () => void }) {
  const [isOpen, setIsOpen] = useState(true);
  
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

  return (
    <Card className="overflow-hidden">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="p-3 cursor-pointer hover-elevate">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                {getIcon()}
                <CardTitle className="text-sm font-medium">{artifact.name}</CardTitle>
              </div>
              <Badge variant={getBadgeVariant()} className="text-xs">
                {artifact.type}
              </Badge>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="p-3 pt-0">
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
}: AITeamPanelProps) {
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
          <Bot className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm">AI Team</span>
        </div>
        <div className="flex items-center gap-2">
          {getStatusBadge()}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Goal Input */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Goal / Instruction
            </label>
            <Textarea
              value={goal}
              onChange={(e) => onGoalChange(e.target.value)}
              placeholder="Describe what you want the AI team to do..."
              className="min-h-[80px] text-sm resize-none"
              data-testid="textarea-goal"
            />
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onRunTask("plan")}
              disabled={isLoading || !goal.trim()}
              className="gap-1.5"
              data-testid="button-plan"
            >
              <FileCode className="h-3.5 w-3.5" />
              Plan
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => onRunTask("implement")}
              disabled={isLoading || !goal.trim()}
              className="gap-1.5"
              data-testid="button-implement"
            >
              <Play className="h-3.5 w-3.5" />
              Implement
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onRunTask("test")}
              disabled={isLoading || !goal.trim()}
              className="gap-1.5"
              data-testid="button-test"
            >
              <TestTube className="h-3.5 w-3.5" />
              Test
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onRunTask("review")}
              disabled={isLoading || !goal.trim()}
              className="gap-1.5"
              data-testid="button-review"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Review
            </Button>
          </div>

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
                Artifacts ({artifacts.length})
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

          {/* Empty State */}
          {!currentTask && artifacts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Bot className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">
                Enter a goal and click an action to get started
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Configure AI backends in AI Agents tab
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
