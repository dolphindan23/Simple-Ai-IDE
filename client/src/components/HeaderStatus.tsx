import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { 
  Server, 
  Lock, 
  LockOpen, 
  Database, 
  Cpu, 
  Play,
  AlertCircle
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { WorkspaceTab } from "./WorkspaceHeader";

interface StatusResponse {
  env: "DEV" | "PROD";
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
    backends: Array<{ id: string; name: string; online: boolean }>;
  };
}

interface StatusChipProps {
  label: string;
  status: "success" | "warning" | "error" | "neutral";
  icon: typeof Server;
  tooltip: string;
  onClick?: () => void;
}

function StatusChip({ label, status, icon: Icon, tooltip, onClick }: StatusChipProps) {
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
            "flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded border transition-opacity",
            "hover:opacity-80",
            statusColors[status],
            onClick ? "cursor-pointer" : "cursor-default"
          )}
          data-testid={`status-chip-${label.toLowerCase().replace(/\s/g, "-")}`}
        >
          <Icon className="h-3 w-3" />
          <span>{label}</span>
          <span className={cn("w-1.5 h-1.5 rounded-full", statusDots[status])} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <p className="text-xs">{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}

interface HeaderStatusProps {
  onNavigate: (tab: WorkspaceTab) => void;
}

export function HeaderStatus({ onNavigate }: HeaderStatusProps) {
  const { data: status, isLoading, error } = useQuery<StatusResponse>({
    queryKey: ["/api/status"],
    refetchInterval: 5000,
    staleTime: 3000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="h-6 w-16 bg-muted animate-pulse rounded" />
        <div className="h-6 w-14 bg-muted animate-pulse rounded" />
        <div className="h-6 w-14 bg-muted animate-pulse rounded" />
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
    return `${status.llm.online}/${status.llm.total} backends online.`;
  };

  const getRunsTooltip = () => {
    if (!status.runs.last) return "No workflow runs yet.";
    if (status.runs.busy) {
      return `${status.runs.active} run${status.runs.active !== 1 ? "s" : ""} in progress.`;
    }
    const lastStatus = status.runs.last.status;
    return `Last run: ${lastStatus}. Click to view runs.`;
  };

  return (
    <div className="flex items-center gap-1.5">
      <StatusChip
        label={status.env}
        status={status.env === "PROD" ? "warning" : "neutral"}
        icon={Server}
        tooltip={`Environment: ${status.env}. Server up ${formatUptime(status.server.uptime)}.`}
      />

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

      {status.runs.busy && (
        <StatusChip
          label={`Run ${status.runs.active}`}
          status="success"
          icon={Play}
          tooltip={getRunsTooltip()}
          onClick={() => onNavigate("runs")}
        />
      )}
    </div>
  );
}
