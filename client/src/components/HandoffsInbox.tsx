import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { 
  Inbox, 
  Send, 
  CheckCircle2, 
  Circle, 
  AlertTriangle,
  MessageSquare,
  Code2,
  HelpCircle,
  Link2,
  Package,
  ArrowRight,
  X,
  Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

type HandoffType = "task" | "patch" | "decision" | "question" | "link" | "artifact" | "api_change" | "blocker" | "fyi";
type HandoffStatus = "unread" | "acknowledged" | "done";

interface Handoff {
  id: string;
  fromWorkspaceId: string;
  toWorkspaceId: string;
  fromAgentKey?: string;
  toAgentKey?: string;
  type: HandoffType;
  title: string;
  body?: string;
  payload: Record<string, any>;
  status: HandoffStatus;
  createdAt: string;
  acknowledgedAt?: string;
  doneAt?: string;
}

interface Workspace {
  id: string;
  name: string;
  kind: string;
}

const typeIcons: Record<HandoffType, typeof Inbox> = {
  task: CheckCircle2,
  patch: Code2,
  decision: HelpCircle,
  question: MessageSquare,
  link: Link2,
  artifact: Package,
  api_change: ArrowRight,
  blocker: AlertTriangle,
  fyi: Circle,
};

const typeLabels: Record<HandoffType, string> = {
  task: "Task",
  patch: "Patch",
  decision: "Decision",
  question: "Question",
  link: "Link",
  artifact: "Artifact",
  api_change: "API Change",
  blocker: "Blocker",
  fyi: "FYI",
};

const typeColors: Record<HandoffType, string> = {
  task: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  patch: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  decision: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  question: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
  link: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  artifact: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  api_change: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  blocker: "bg-red-500/10 text-red-400 border-red-500/30",
  fyi: "bg-gray-500/10 text-gray-400 border-gray-500/30",
};

interface HandoffsInboxProps {
  projectId: string | null;
  currentWorkspaceId: string | null;
  workspaces: Workspace[];
}

export function HandoffsInbox({ projectId, currentWorkspaceId, workspaces }: HandoffsInboxProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [selectedHandoff, setSelectedHandoff] = useState<Handoff | null>(null);
  
  const [newType, setNewType] = useState<HandoffType>("task");
  const [newToWorkspace, setNewToWorkspace] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ handoffs: Handoff[]; unreadCount: number }>({
    queryKey: ["/api/ws", currentWorkspaceId, "handoffs"],
    queryFn: async () => {
      if (!currentWorkspaceId || !projectId) return { handoffs: [], unreadCount: 0 };
      const res = await fetch(`/api/ws/${currentWorkspaceId}/handoffs?projectId=${projectId}`);
      if (!res.ok) return { handoffs: [], unreadCount: 0 };
      return res.json();
    },
    enabled: !!currentWorkspaceId && !!projectId,
    refetchInterval: 30000,
  });

  const handoffs = data?.handoffs || [];
  const unreadCount = data?.unreadCount || 0;

  const acknowledgeMutation = useMutation({
    mutationFn: async (handoffId: string) => {
      return apiRequest("POST", `/api/handoffs/${handoffId}/ack`, { projectId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ws", currentWorkspaceId, "handoffs"] });
    },
  });

  const doneMutation = useMutation({
    mutationFn: async (handoffId: string) => {
      return apiRequest("POST", `/api/handoffs/${handoffId}/done`, { projectId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ws", currentWorkspaceId, "handoffs"] });
      setSelectedHandoff(null);
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (data: { toWorkspaceId: string; type: HandoffType; title: string; body?: string }) => {
      return apiRequest("POST", `/api/ws/${currentWorkspaceId}/handoffs`, {
        ...data,
        projectId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ws", currentWorkspaceId, "handoffs"] });
      setComposeOpen(false);
      setNewTitle("");
      setNewBody("");
      setNewType("task");
      setNewToWorkspace("");
    },
  });

  const handleSend = () => {
    if (!newTitle.trim() || !newToWorkspace) return;
    sendMutation.mutate({
      toWorkspaceId: newToWorkspace,
      type: newType,
      title: newTitle.trim(),
      body: newBody.trim() || undefined,
    });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  const getWorkspaceName = (wsId: string) => {
    return workspaces.find(ws => ws.id === wsId)?.name || wsId;
  };

  const otherWorkspaces = workspaces.filter(ws => ws.id !== currentWorkspaceId);

  if (!projectId || !currentWorkspaceId) {
    return null;
  }

  return (
    <>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-7 w-7 relative"
            data-testid="button-handoffs-inbox"
          >
            <Inbox className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-red-500 text-[9px] font-medium text-white flex items-center justify-center">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent className="w-[400px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle className="flex items-center justify-between">
              <span>Handoffs</span>
              <Button 
                size="sm" 
                onClick={() => setComposeOpen(true)}
                data-testid="button-compose-handoff"
              >
                <Send className="h-3.5 w-3.5 mr-1.5" />
                Send Handoff
              </Button>
            </SheetTitle>
            <SheetDescription>
              Messages from other workspaces and agent teams
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="h-[calc(100vh-140px)] mt-4">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : handoffs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Inbox className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No handoffs yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {handoffs.map((handoff) => {
                  const Icon = typeIcons[handoff.type];
                  const isUnread = handoff.status === "unread";
                  const isDone = handoff.status === "done";
                  
                  return (
                    <button
                      key={handoff.id}
                      className={cn(
                        "w-full text-left p-3 rounded-lg border transition-colors",
                        isUnread 
                          ? "bg-accent/50 border-accent" 
                          : "bg-card border-border hover:bg-accent/30",
                        isDone && "opacity-60"
                      )}
                      onClick={() => {
                        setSelectedHandoff(handoff);
                        if (isUnread) {
                          acknowledgeMutation.mutate(handoff.id);
                        }
                      }}
                      data-testid={`handoff-item-${handoff.id}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "p-1.5 rounded",
                          typeColors[handoff.type]
                        )}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-medium text-sm truncate">
                              {handoff.title}
                            </span>
                            {isUnread && (
                              <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>From: {getWorkspaceName(handoff.fromWorkspaceId)}</span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatTime(handoff.createdAt)}
                            </span>
                          </div>
                        </div>
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          {typeLabels[handoff.type]}
                        </Badge>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <Dialog open={!!selectedHandoff} onOpenChange={(open) => !open && setSelectedHandoff(null)}>
        {selectedHandoff && (
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <div className="flex items-center gap-2 mb-2">
                <div className={cn("p-1.5 rounded", typeColors[selectedHandoff.type])}>
                  {(() => {
                    const Icon = typeIcons[selectedHandoff.type];
                    return <Icon className="h-4 w-4" />;
                  })()}
                </div>
                <Badge variant="outline">{typeLabels[selectedHandoff.type]}</Badge>
              </div>
              <DialogTitle>{selectedHandoff.title}</DialogTitle>
              <DialogDescription>
                From {getWorkspaceName(selectedHandoff.fromWorkspaceId)} • {formatTime(selectedHandoff.createdAt)}
              </DialogDescription>
            </DialogHeader>
            
            {selectedHandoff.body && (
              <div className="py-4">
                <p className="text-sm whitespace-pre-wrap">{selectedHandoff.body}</p>
              </div>
            )}
            
            {Object.keys(selectedHandoff.payload).length > 0 && (
              <div className="py-2">
                <Separator className="mb-3" />
                <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-40">
                  {JSON.stringify(selectedHandoff.payload, null, 2)}
                </pre>
              </div>
            )}
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedHandoff(null)}>
                Close
              </Button>
              {selectedHandoff.status !== "done" && (
                <Button 
                  onClick={() => doneMutation.mutate(selectedHandoff.id)}
                  disabled={doneMutation.isPending}
                  data-testid="button-mark-done"
                >
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />
                  Mark Done
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Handoff</DialogTitle>
            <DialogDescription>
              Send a structured message to another workspace or agent team
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>To Workspace</Label>
                <Select value={newToWorkspace} onValueChange={setNewToWorkspace}>
                  <SelectTrigger data-testid="select-handoff-to">
                    <SelectValue placeholder="Select workspace" />
                  </SelectTrigger>
                  <SelectContent>
                    {otherWorkspaces.map((ws) => (
                      <SelectItem key={ws.id} value={ws.id}>
                        {ws.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={newType} onValueChange={(v) => setNewType(v as HandoffType)}>
                  <SelectTrigger data-testid="select-handoff-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(typeLabels).map(([key, label]) => {
                      const Icon = typeIcons[key as HandoffType];
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
            </div>
            
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g., API endpoint updated"
                data-testid="input-handoff-title"
              />
            </div>
            
            <div className="space-y-2">
              <Label>Details (optional)</Label>
              <Textarea
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                placeholder="Describe what changed or what's needed..."
                rows={4}
                data-testid="input-handoff-body"
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setComposeOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSend}
              disabled={!newTitle.trim() || !newToWorkspace || sendMutation.isPending}
              data-testid="button-send-handoff"
            >
              <Send className="h-4 w-4 mr-1.5" />
              {sendMutation.isPending ? "Sending..." : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
