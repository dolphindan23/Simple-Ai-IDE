import { useState, useEffect, useRef, useCallback } from "react";

interface BackendEvent {
  id: number;
  run_id: string;
  agent_id: string | null;
  type: string;
  message: string;
  data: Record<string, unknown>;
  created_at: string;
  workspace_id?: string | null;
}

export interface AIRunEvent {
  id: string;
  run_id: string;
  event_type: "RUN_STATUS" | "AGENT_STATUS" | "STEP" | "READ_FILE" | "WRITE_FILE" | "TOOL_CALL" | "ERROR" | "PROPOSE_CHANGESET" | "NEEDS_APPROVAL";
  agent_role: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  workspace_id?: string | null;
}

function transformEvent(backendEvent: BackendEvent): AIRunEvent {
  return {
    id: String(backendEvent.id),
    run_id: backendEvent.run_id,
    event_type: backendEvent.type as AIRunEvent["event_type"],
    agent_role: backendEvent.agent_id,
    payload: { ...backendEvent.data, message: backendEvent.message },
    created_at: backendEvent.created_at,
    workspace_id: backendEvent.workspace_id
  };
}

export interface AIRun {
  id: string;
  run_key: string | null;
  workspace_id: string | null;
  mode: string;
  status: string;
  goal: string | null;
  agents: string[];
  fast_mode: boolean;
  started_at: string | null;
  ended_at: string | null;
  result_summary: string | null;
  created_by_user_id: string | null;
  created_at: string;
}

export interface AgentProfile {
  id: string;
  role: string;
  display_name: string;
  description: string | null;
  avatar_emoji: string;
  color_hex: string;
  model: string | null;
  max_context_tokens: number | null;
  system_prompt: string | null;
  default_temperature: number | null;
  tools_enabled: string[] | null;
  risk_tolerance: string | null;
  verbosity: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string | null;
}

export type SidebarScope = "current" | "all";

interface UseAIRunEventsResult {
  events: AIRunEvent[];
  runs: AIRun[];
  agentProfiles: AgentProfile[];
  isConnected: boolean;
  error: string | null;
  sidebarWorkspaceId: string | null;
}

interface UseAIRunEventsOptions {
  workspaceId?: string | null;
  scope?: SidebarScope;
}

export function useAIRunEvents(options: UseAIRunEventsOptions = {}): UseAIRunEventsResult {
  const { workspaceId, scope = "current" } = options;
  const effectiveWorkspaceId = scope === "all" ? null : workspaceId;
  
  const [events, setEvents] = useState<AIRunEvent[]>([]);
  const [runs, setRuns] = useState<AIRun[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarWorkspaceId, setSidebarWorkspaceId] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const profilesFetchedRef = useRef(false);

  useEffect(() => {
    if (profilesFetchedRef.current) return;
    profilesFetchedRef.current = true;
    
    fetch("/api/ai/agent-profiles")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAgentProfiles(data);
        }
      })
      .catch(() => {});
  }, []);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const url = effectiveWorkspaceId 
        ? `/api/ai/stream?workspaceId=${encodeURIComponent(effectiveWorkspaceId)}`
        : "/api/ai/stream?workspaceId=all";
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
        setError(null);
      };

      es.addEventListener("init", (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.runs) setRuns(data.runs);
          if (data.events) {
            const transformedEvents = (data.events as BackendEvent[]).map(transformEvent);
            setEvents(transformedEvents);
          }
          if (data.agents) setAgentProfiles(data.agents);
        } catch (err) {
          console.error("Failed to parse init event:", err);
        }
      });

      es.addEventListener("run_event", (e) => {
        try {
          const backendEvent = JSON.parse(e.data) as BackendEvent;
          const event = transformEvent(backendEvent);
          setEvents((prev) => {
            const exists = prev.some((ev) => ev.id === event.id);
            if (exists) return prev;
            return [...prev, event].slice(-200);
          });

          if (event.event_type === "RUN_STATUS") {
            setRuns((prevRuns) => {
              const payload = event.payload as { status?: string; message?: string };
              return prevRuns.map((r) => {
                if (r.id === event.run_id) {
                  return {
                    ...r,
                    status: payload.status || r.status,
                    result_summary: payload.message || r.result_summary,
                  };
                }
                return r;
              });
            });
          }
        } catch (err) {
          console.error("Failed to parse run_event:", err);
        }
      });

      es.addEventListener("new_run", (e) => {
        try {
          const run = JSON.parse(e.data) as AIRun;
          setRuns((prev) => {
            const exists = prev.some((r) => r.id === run.id);
            if (exists) return prev;
            return [run, ...prev].slice(0, 50);
          });
        } catch (err) {
          console.error("Failed to parse new_run:", err);
        }
      });

      es.onerror = () => {
        setIsConnected(false);
        setError("Connection lost, reconnecting...");
        es.close();

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };
    } catch (err) {
      setError("Failed to connect to event stream");
      setIsConnected(false);
    }
  }, [effectiveWorkspaceId]);

  useEffect(() => {
    connect();
    setSidebarWorkspaceId(effectiveWorkspaceId);

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect, effectiveWorkspaceId]);

  return { events, runs, agentProfiles, isConnected, error, sidebarWorkspaceId };
}

export function useAgentProfiles(): { profiles: AgentProfile[]; loading: boolean } {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/ai/agent-profiles")
      .then((res) => res.json())
      .then((data) => {
        setProfiles(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return { profiles, loading };
}
