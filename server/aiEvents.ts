import { EventEmitter } from "events";
import { addRunEvent, updateRunStatus, getRun, type AiRunEvent, type AiRun } from "./aiDb";

const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

export type RunEventType = AiRunEvent["type"];
export type AgentStatus = "idle" | "working" | "waiting" | "done" | "error";

const CRITICAL_EVENT_TYPES: RunEventType[] = [
  "RUN_STATUS",
  "ERROR", 
  "NEEDS_APPROVAL",
  "AGENT_STATUS",
  "PROPOSE_CHANGESET"
];

const VERBOSE_EVENT_TYPES: RunEventType[] = [
  "READ_FILE",
  "TOOL_CALL",
  "NOTE"
];

function isRunInFastMode(runId: string): boolean {
  try {
    const run = getRun(runId);
    return run?.fast_mode || false;
  } catch {
    return false;
  }
}

function shouldEmitEvent(runId: string, type: RunEventType): boolean {
  if (CRITICAL_EVENT_TYPES.includes(type)) {
    return true;
  }
  
  if (!isRunInFastMode(runId)) {
    return true;
  }
  
  if (VERBOSE_EVENT_TYPES.includes(type)) {
    return false;
  }
  
  return true;
}

export interface EmitEventOptions {
  runId: string;
  agentId?: string;
  type: RunEventType;
  message: string;
  data?: Record<string, unknown>;
}

export function emitRunEvent(options: EmitEventOptions): AiRunEvent | null {
  const { runId, agentId, type, message, data = {} } = options;
  
  if (!shouldEmitEvent(runId, type)) {
    return null;
  }
  
  const event = addRunEvent({
    run_id: runId,
    agent_id: agentId || null,
    type,
    message,
    data
  });
  
  eventBus.emit(`run:${runId}`, event);
  eventBus.emit("run:*", event);
  
  return event;
}

export function emitRunStatus(runId: string, status: AiRun["status"], message?: string): AiRunEvent | null {
  updateRunStatus(runId, status);
  
  return emitRunEvent({
    runId,
    type: "RUN_STATUS",
    message: message || `Run status changed to ${status}`,
    data: { status }
  });
}

export function emitAgentStatus(runId: string, agentId: string, status: AgentStatus, message?: string): AiRunEvent | null {
  const statusMessages: Record<AgentStatus, string> = {
    idle: `${agentId} is idle`,
    working: `${agentId} is working`,
    waiting: `${agentId} is waiting`,
    done: `${agentId} completed`,
    error: `${agentId} encountered an error`
  };
  
  return emitRunEvent({
    runId,
    agentId,
    type: "AGENT_STATUS",
    message: message || statusMessages[status],
    data: { status }
  });
}

export interface StepProgress {
  step_index?: number;
  step_total?: number;
  phase?: string;
}

export function emitStep(runId: string, agentId: string, message: string, data?: Record<string, unknown>, progress?: StepProgress): AiRunEvent | null {
  return emitRunEvent({
    runId,
    agentId,
    type: "STEP",
    message,
    data: { ...data, ...progress }
  });
}

export function emitReadFile(runId: string, agentId: string, filePath: string): AiRunEvent | null {
  return emitRunEvent({
    runId,
    agentId,
    type: "READ_FILE",
    message: `Reading ${filePath}`,
    data: { path: filePath }
  });
}

export function emitWriteFile(runId: string, agentId: string, filePath: string, linesAdded?: number, linesRemoved?: number): AiRunEvent | null {
  return emitRunEvent({
    runId,
    agentId,
    type: "WRITE_FILE",
    message: `Writing ${filePath}`,
    data: { path: filePath, linesAdded, linesRemoved }
  });
}

export function emitToolCall(runId: string, agentId: string, toolName: string, message?: string): AiRunEvent | null {
  return emitRunEvent({
    runId,
    agentId,
    type: "TOOL_CALL",
    message: message || `Calling tool: ${toolName}`,
    data: { tool: toolName }
  });
}

export function emitNote(runId: string, message: string, agentId?: string): AiRunEvent | null {
  return emitRunEvent({
    runId,
    agentId,
    type: "NOTE",
    message
  });
}

export function emitError(runId: string, error: string, agentId?: string): AiRunEvent | null {
  return emitRunEvent({
    runId,
    agentId,
    type: "ERROR",
    message: error,
    data: { error }
  });
}

export function emitProposeChangeset(runId: string, agentId: string, files: string[], summary?: string): AiRunEvent | null {
  return emitRunEvent({
    runId,
    agentId,
    type: "PROPOSE_CHANGESET",
    message: summary || `Proposing changes to ${files.length} file(s)`,
    data: { files }
  });
}

export function emitNeedsApproval(runId: string, reason?: string): AiRunEvent | null {
  updateRunStatus(runId, "needs_approval");
  
  return emitRunEvent({
    runId,
    type: "NEEDS_APPROVAL",
    message: reason || "Run requires approval to continue",
    data: { reason }
  });
}

export function subscribeToRun(runId: string, callback: (event: AiRunEvent) => void): () => void {
  const handler = (event: AiRunEvent) => callback(event);
  eventBus.on(`run:${runId}`, handler);
  
  return () => {
    eventBus.off(`run:${runId}`, handler);
  };
}

export function subscribeToAllRuns(callback: (event: AiRunEvent) => void): () => void {
  const handler = (event: AiRunEvent) => callback(event);
  eventBus.on("run:*", handler);
  
  return () => {
    eventBus.off("run:*", handler);
  };
}

export { eventBus };
