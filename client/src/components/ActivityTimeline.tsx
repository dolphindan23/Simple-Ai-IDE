import { useRef, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AIRunEvent, AgentProfile } from "@/hooks/useAIRunEvents";
import { cn } from "@/lib/utils";
import {
  Play,
  CheckCircle,
  XCircle,
  FileText,
  Pencil,
  Clock,
  Loader2,
  AlertTriangle,
  GitBranch,
  ShieldAlert,
} from "lucide-react";

interface ActivityTimelineProps {
  events: AIRunEvent[];
  agentProfiles: AgentProfile[];
  maxEvents?: number;
}

const eventIcons: Record<string, typeof Play> = {
  RUN_STATUS: Play,
  AGENT_STATUS: Loader2,
  STEP: Clock,
  READ_FILE: FileText,
  WRITE_FILE: Pencil,
  TOOL_CALL: GitBranch,
  ERROR: XCircle,
  PROPOSE_CHANGESET: GitBranch,
  NEEDS_APPROVAL: ShieldAlert,
};

const eventColors: Record<string, string> = {
  RUN_STATUS: "text-blue-400",
  AGENT_STATUS: "text-purple-400",
  STEP: "text-muted-foreground",
  READ_FILE: "text-cyan-400",
  WRITE_FILE: "text-green-400",
  TOOL_CALL: "text-orange-400",
  ERROR: "text-red-400",
  PROPOSE_CHANGESET: "text-yellow-400",
  NEEDS_APPROVAL: "text-amber-500",
};

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  return date.toLocaleDateString();
}

function getEventDescription(event: AIRunEvent): string {
  const payload = event.payload as Record<string, unknown>;

  switch (event.event_type) {
    case "RUN_STATUS":
      return payload.message as string || `Run ${payload.status}`;
    case "AGENT_STATUS":
      return payload.message as string || `Agent ${payload.status}`;
    case "STEP": {
      const message = payload.message as string || "Processing...";
      const stepIndex = payload.step_index as number | undefined;
      const stepTotal = payload.step_total as number | undefined;
      const phase = payload.phase as string | undefined;
      const progress = stepIndex && stepTotal ? ` (${stepIndex}/${stepTotal})` : "";
      const phaseLabel = phase ? `[${phase}] ` : "";
      return `${phaseLabel}${message}${progress}`;
    }
    case "READ_FILE":
      return `Read ${payload.path || "file"}`;
    case "WRITE_FILE":
      return `Write ${payload.path || "file"}`;
    case "TOOL_CALL":
      return `Tool: ${payload.tool || "unknown"}`;
    case "ERROR":
      return payload.message as string || "Error occurred";
    case "PROPOSE_CHANGESET":
      return `Proposed ${(payload.files as string[])?.length || 0} file changes`;
    case "NEEDS_APPROVAL":
      return payload.message as string || "Awaiting approval";
    default:
      return event.event_type;
  }
}

export function ActivityTimeline({ events, agentProfiles, maxEvents = 50 }: ActivityTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const sortedEvents = [...events]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, maxEvents);

  useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [events.length]);

  const getAgentProfile = (role: string | null): AgentProfile | undefined => {
    if (!role) return undefined;
    return agentProfiles.find((p) => p.role === role);
  };

  if (sortedEvents.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center h-32 text-muted-foreground"
        data-testid="activity-timeline-empty"
      >
        <Clock className="w-8 h-8 mb-2 opacity-50" />
        <p className="text-sm">No activity yet</p>
        <p className="text-xs opacity-70">Events will appear here as agents work</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full" data-testid="activity-timeline">
      <div ref={scrollRef} className="space-y-1 p-2">
        {sortedEvents.map((event) => {
          const Icon = eventIcons[event.event_type] || Clock;
          const iconColor = eventColors[event.event_type] || "text-muted-foreground";
          const agent = getAgentProfile(event.agent_role);

          return (
            <div
              key={event.id}
              className="flex items-start gap-2 p-2 rounded-md hover-elevate group"
              data-testid={`event-${event.id}`}
            >
              <div className={cn("mt-0.5", iconColor)}>
                <Icon className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {agent && (
                    <span
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: `${agent.color_hex}20`,
                        color: agent.color_hex,
                      }}
                    >
                      {agent.avatar_emoji} {agent.display_name}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground/60">
                    {formatTimeAgo(event.created_at)}
                  </span>
                </div>
                <p className="text-xs text-foreground/80 mt-0.5 truncate">
                  {getEventDescription(event)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

interface CompactActivityFeedProps {
  events: AIRunEvent[];
  maxEvents?: number;
}

export function CompactActivityFeed({ events, maxEvents = 5 }: CompactActivityFeedProps) {
  const recentEvents = [...events]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, maxEvents);

  if (recentEvents.length === 0) {
    return (
      <div className="text-xs text-muted-foreground text-center py-2">
        No recent activity
      </div>
    );
  }

  return (
    <div className="space-y-1" data-testid="compact-activity-feed">
      {recentEvents.map((event) => {
        const Icon = eventIcons[event.event_type] || Clock;
        const iconColor = eventColors[event.event_type] || "text-muted-foreground";

        return (
          <div
            key={event.id}
            className="flex items-center gap-2 text-xs"
            data-testid={`compact-event-${event.id}`}
          >
            <Icon className={cn("w-3 h-3", iconColor)} />
            <span className="truncate flex-1 text-muted-foreground">
              {getEventDescription(event)}
            </span>
            <span className="text-[10px] text-muted-foreground/50">
              {formatTimeAgo(event.created_at)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
