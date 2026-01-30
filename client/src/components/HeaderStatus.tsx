import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { 
  Server, 
  Lock, 
  LockOpen, 
  Database, 
  Cpu, 
  Play,
  AlertCircle,
  PanelTopClose,
  PanelTop,
  Files,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  Save,
  Circle
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { WorkspaceTab } from "./WorkspaceHeader";

export type RunState = "idle" | "running" | "waiting" | "error" | "done";

interface StatusResponse {
  env: "DEV" | "PROD";
  envDetails: {
    effective: "DEV" | "PROD";
    nodeEnv: string;
    simpleaideEnv: string | null;
  };
  server: {
    port: number | string;
    nodeEnv: string;
    uptime: number;
  };
  runs: {
    active: number;
    busy: boolean;
    last: {
      id: string;
      status: string;
      startedAt: string;
      completedAt?: string;
      goal: string;
      ageMs: number;
    } | null;
  };
  vault: {
    exists: boolean;
    locked: boolean;
    autoLockMinutes: number;
    autoLockRemainingMs: number | null;
  };
  db: {
    connected: boolean;
    count: number;
    type: string;
  };
  llm: {
    online: number;
    total: number;
    backends: Array<{ id: string; name: string; online: boolean; lastChecked?: number; error?: string }>;
  };
  security?: {
    confirmationTokens: string;
    sessionSecretSet: boolean;
  };
}

interface StatusChipProps {
  label: string;
  status: "success" | "warning" | "error" | "neutral";
  icon: typeof Server;
  tooltip: string;
  onClick?: () => void;
  animate?: boolean;
}

function StatusChip({ label, status, icon: Icon, tooltip, onClick, animate }: StatusChipProps) {
  const statusColors = {
    success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    warning: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    error: "bg-red-500/10 text-red-400 border-red-500/30",
    neutral: "bg-muted text-muted-foreground border-border",
  };

  const statusDots = {
    success: "bg-emerald-400",
    warning: "bg-amber-400",
    error: "bg-red-400",
    neutral: "bg-muted-foreground",
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            "flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border transition-opacity",
            "hover:opacity-80",
            statusColors[status],
            onClick ? "cursor-pointer" : "cursor-default"
          )}
          data-testid={`status-chip-${label.toLowerCase().replace(/\s/g, "-").replace(/[:/]/g, "")}`}
        >
          <Icon className={cn("h-2.5 w-2.5", animate && "animate-spin")} />
          <span>{label}</span>
          <span className={cn("w-1 h-1 rounded-full", statusDots[status])} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <p className="text-[10px]">{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}

interface HeaderStatusProps {
  onNavigate: (tab: WorkspaceTab) => void;
  showMainHeader: boolean;
  onToggleMainHeader: () => void;
  contextFilesCount?: number;
  onOpenContextManager?: () => void;
  runState?: RunState;
  onOpenActivityTimeline?: () => void;
  isDirty?: boolean;
}

export function HeaderStatus({ 
  onNavigate, 
  showMainHeader, 
  onToggleMainHeader,
  contextFilesCount = 0,
  onOpenContextManager,
  runState = "idle",
  onOpenActivityTimeline,
  isDirty = false,
}: HeaderStatusProps) {
  const { data: status, isLoading, error } = useQuery<StatusResponse>({
    queryKey: ["/api/status"],
    refetchInterval: 5000,
    staleTime: 3000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-1">
        <div className="h-4 w-12 bg-muted animate-pulse rounded" />
        <div className="h-4 w-10 bg-muted animate-pulse rounded" />
        <div className="h-4 w-10 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  if (error || !status) {
    return (
      <StatusChip
        label="Status"
        status="error"
        icon={AlertCircle}
        tooltip="Failed to load system status"
      />
    );
  }

  const formatUptime = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
  };

  const getVaultTooltip = () => {
    if (!status.vault.exists) return "No vault configured. Click to set up secrets.";
    if (status.vault.locked) return "Vault is locked. Click to unlock.";
    if (status.vault.autoLockRemainingMs) {
      const mins = Math.ceil(status.vault.autoLockRemainingMs / 60000);
      return `Vault unlocked. Auto-locks in ${mins}m.`;
    }
    return "Vault is unlocked.";
  };

  const getDbTooltip = () => {
    if (!status.db.connected) return "Database not available.";
    if (status.db.count === 0) return "No databases. Click to create one.";
    return `${status.db.count} database${status.db.count !== 1 ? "s" : ""} available.`;
  };

  const getLlmTooltip = () => {
    if (status.llm.total === 0) return "No LLM backends configured. Click to add.";
    const offlineBackends = status.llm.backends.filter(b => !b.online);
    if (offlineBackends.length > 0) {
      const offlineNames = offlineBackends.map(b => b.name).join(", ");
      return `${status.llm.online}/${status.llm.total} backends online. Offline: ${offlineNames}`;
    }
    return `${status.llm.online}/${status.llm.total} backends online.`;
  };

  const getRunStateConfig = (): { label: string; status: "success" | "warning" | "error" | "neutral"; icon: typeof Play; tooltip: string; animate?: boolean } => {
    switch (runState) {
      case "running":
        return {
          label: "RUN: active",
          status: "success",
          icon: Loader2,
          tooltip: "Agent is currently running a task. Click to view activity.",
          animate: true,
        };
      case "waiting":
        return {
          label: "RUN: waiting",
          status: "warning",
          icon: Clock,
          tooltip: "Agent is waiting for approval or input. Click to view.",
          animate: false,
        };
      case "error":
        return {
          label: "RUN: error",
          status: "error",
          icon: XCircle,
          tooltip: "Last run encountered an error. Click to view details.",
          animate: false,
        };
      case "done":
        return {
          label: "RUN: done",
          status: "success",
          icon: CheckCircle2,
          tooltip: "Last run completed successfully. Click to view.",
          animate: false,
        };
      case "idle":
      default:
        return {
          label: "RUN: idle",
          status: "neutral",
          icon: Circle,
          tooltip: "No active runs. Click to view activity timeline.",
          animate: false,
        };
    }
  };

  const runConfig = getRunStateConfig();

  return (
    <div className="flex items-center gap-1">
      {/* Toggle main header visibility */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onToggleMainHeader}
            className="flex items-center justify-center h-4 w-4 text-muted-foreground hover:text-foreground transition-colors rounded"
            data-testid="button-toggle-main-header"
          >
            {showMainHeader ? (
              <PanelTopClose className="h-2.5 w-2.5" />
            ) : (
              <PanelTop className="h-2.5 w-2.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-[10px]">{showMainHeader ? "Hide header" : "Show header"}</p>
        </TooltipContent>
      </Tooltip>

      {/* Left group: workspace + AI state */}
      <StatusChip
        label={status.env}
        status={status.env === "PROD" ? "warning" : "neutral"}
        icon={Server}
        tooltip={`Environment: ${status.env}${status.envDetails?.simpleaideEnv ? ` (SIMPLEAIDE_ENV=${status.envDetails.simpleaideEnv})` : ''} | NODE_ENV=${status.envDetails?.nodeEnv || 'development'}. Up ${formatUptime(status.server.uptime)}.`}
      />

      <StatusChip
        label={`CTX: ${contextFilesCount}`}
        status={contextFilesCount > 0 ? "success" : "neutral"}
        icon={Files}
        tooltip={contextFilesCount > 0 
          ? `${contextFilesCount} file${contextFilesCount !== 1 ? 's' : ''} included in AI context. Click to manage.`
          : "No files in AI context. Click to add files."
        }
        onClick={onOpenContextManager}
      />

      <StatusChip
        label={runConfig.label}
        status={runConfig.status}
        icon={runConfig.icon}
        tooltip={runConfig.tooltip}
        onClick={onOpenActivityTimeline}
        animate={runConfig.animate}
      />

      {/* Separator */}
      <div className="h-3 w-px bg-border mx-0.5" />

      {/* Right group: infrastructure + capacity */}
      <StatusChip
        label="Vault"
        status={
          !status.vault.exists
            ? "warning"
            : status.vault.locked
            ? "neutral"
            : "success"
        }
        icon={status.vault.locked ? Lock : LockOpen}
        tooltip={getVaultTooltip()}
        onClick={() => onNavigate("secrets")}
      />

      <StatusChip
        label="DB"
        status={
          !status.db.connected
            ? "error"
            : status.db.count === 0
            ? "warning"
            : "success"
        }
        icon={Database}
        tooltip={getDbTooltip()}
        onClick={() => onNavigate("database")}
      />

      <StatusChip
        label={status.llm.total > 0 ? `LLM ${status.llm.online}/${status.llm.total}` : "LLM"}
        status={
          status.llm.total === 0
            ? "warning"
            : status.llm.online < status.llm.total
            ? "error"
            : "success"
        }
        icon={Cpu}
        tooltip={getLlmTooltip()}
        onClick={() => onNavigate("ai-agents")}
      />

      <StatusChip
        label={isDirty ? "Unsaved" : "Saved"}
        status={isDirty ? "warning" : "neutral"}
        icon={Save}
        tooltip={isDirty 
          ? "You have unsaved changes. Use Ctrl+S to save."
          : "All changes saved."
        }
      />
    </div>
  );
}
