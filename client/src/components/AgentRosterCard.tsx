import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { AgentProfile, AIRunEvent } from "@/hooks/useAIRunEvents";
import { cn } from "@/lib/utils";

interface AgentRosterCardProps {
  profile: AgentProfile;
  status: "idle" | "working" | "waiting" | "done" | "error";
  lastActivity?: string;
  compact?: boolean;
}

const statusColors: Record<string, string> = {
  idle: "bg-muted text-muted-foreground",
  working: "bg-blue-500/20 text-blue-400 animate-pulse",
  waiting: "bg-yellow-500/20 text-yellow-400",
  done: "bg-green-500/20 text-green-400",
  error: "bg-red-500/20 text-red-400",
};

const statusLabels: Record<string, string> = {
  idle: "Idle",
  working: "Working",
  waiting: "Waiting",
  done: "Done",
  error: "Error",
};

export function AgentRosterCard({ profile, status, lastActivity, compact }: AgentRosterCardProps) {
  if (compact) {
    return (
      <div
        className="flex items-center gap-2 p-2 rounded-md hover-elevate"
        data-testid={`agent-card-${profile.role}`}
      >
        <div
          className="flex items-center justify-center w-7 h-7 rounded-full text-sm"
          style={{ backgroundColor: `${profile.color_hex}20`, color: profile.color_hex }}
        >
          {profile.avatar_emoji}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium truncate">{profile.display_name}</span>
        </div>
        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", statusColors[status])}>
          {statusLabels[status]}
        </Badge>
      </div>
    );
  }

  return (
    <Card
      className="hover-elevate overflow-visible"
      data-testid={`agent-card-${profile.role}`}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <div
            className="flex items-center justify-center w-10 h-10 rounded-lg text-lg"
            style={{ backgroundColor: `${profile.color_hex}20`, color: profile.color_hex }}
          >
            {profile.avatar_emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{profile.display_name}</span>
              <Badge
                variant="outline"
                className={cn("text-[10px] px-1.5 py-0", statusColors[status])}
              >
                {statusLabels[status]}
              </Badge>
            </div>
            {profile.description && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {profile.description}
              </p>
            )}
            {lastActivity && (
              <p className="text-[10px] text-muted-foreground/70 mt-1 truncate">
                {lastActivity}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface AgentRosterProps {
  profiles: AgentProfile[];
  events: AIRunEvent[];
  compact?: boolean;
}

export function AgentRoster({ profiles, events, compact }: AgentRosterProps) {
  const getAgentStatus = (role: string): { status: "idle" | "working" | "waiting" | "done" | "error"; lastActivity?: string } => {
    const agentEvents = events
      .filter((e) => e.agent_role === role)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    if (agentEvents.length === 0) {
      return { status: "idle" };
    }

    const latest = agentEvents[0];
    let lastActivity: string | undefined;

    if (latest.event_type === "STEP") {
      lastActivity = (latest.payload as { message?: string }).message;
    } else if (latest.event_type === "AGENT_STATUS") {
      const payload = latest.payload as { status?: string; message?: string };
      if (payload.status === "working") {
        return { status: "working", lastActivity: payload.message };
      } else if (payload.status === "waiting") {
        return { status: "waiting", lastActivity: payload.message };
      } else if (payload.status === "done") {
        return { status: "done", lastActivity: payload.message };
      } else if (payload.status === "error") {
        return { status: "error", lastActivity: payload.message };
      }
    } else if (latest.event_type === "ERROR") {
      return { status: "error", lastActivity: (latest.payload as { message?: string }).message };
    }

    const recentEvents = agentEvents.filter((e) => {
      const age = Date.now() - new Date(e.created_at).getTime();
      return age < 30000;
    });

    if (recentEvents.length > 0) {
      const hasWorking = recentEvents.some(
        (e) => e.event_type === "AGENT_STATUS" && (e.payload as { status?: string }).status === "working"
      );
      if (hasWorking) {
        return { status: "working", lastActivity };
      }
    }

    return { status: "idle", lastActivity };
  };

  return (
    <div className={cn("space-y-2", compact && "space-y-1")} data-testid="agent-roster">
      {profiles.map((profile) => {
        const { status, lastActivity } = getAgentStatus(profile.role);
        return (
          <AgentRosterCard
            key={profile.id}
            profile={profile}
            status={status}
            lastActivity={lastActivity}
            compact={compact}
          />
        );
      })}
    </div>
  );
}
