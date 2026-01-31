import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";

const PROJECT_ROOT = path.resolve(process.cwd());
const DB_DIR = path.join(PROJECT_ROOT, ".simpleaide", "databases");
const AI_DB_PATH = path.join(DB_DIR, "simpleaide_internal.db");

let db: Database.Database | null = null;

function ensureDbDir() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
}

function getDb(): Database.Database {
  if (db) return db;
  
  ensureDbDir();
  db = new Database(AI_DB_PATH);
  initSchema(db);
  return db;
}

function initSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_profiles (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      avatar_emoji TEXT DEFAULT '🤖',
      color_hex TEXT DEFAULT '#6366f1',
      model TEXT NOT NULL,
      max_context_tokens INTEGER DEFAULT 128000,
      system_prompt TEXT,
      default_temperature REAL DEFAULT 0.7,
      tools_enabled TEXT DEFAULT '[]',
      risk_tolerance TEXT DEFAULT 'balanced' CHECK (risk_tolerance IN ('conservative', 'balanced', 'aggressive')),
      verbosity TEXT DEFAULT 'normal' CHECK (verbosity IN ('low', 'normal', 'high')),
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    
    CREATE TABLE IF NOT EXISTS ai_runs (
      id TEXT PRIMARY KEY,
      run_key TEXT UNIQUE,
      workspace_id TEXT,
      mode TEXT NOT NULL CHECK (mode IN ('plan', 'implement', 'test', 'review', 'verify', 'autonomous')),
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'needs_approval', 'completed', 'failed', 'cancelled')),
      goal TEXT,
      agents TEXT DEFAULT '[]',
      fast_mode INTEGER DEFAULT 0,
      created_by_user_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    
    CREATE INDEX IF NOT EXISTS idx_runs_workspace ON ai_runs(workspace_id);
    
    CREATE TABLE IF NOT EXISTS ai_run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      agent_id TEXT,
      type TEXT NOT NULL CHECK (type IN ('RUN_STATUS', 'AGENT_STATUS', 'STEP', 'READ_FILE', 'WRITE_FILE', 'TOOL_CALL', 'NOTE', 'ERROR', 'PROPOSE_CHANGESET', 'NEEDS_APPROVAL')),
      message TEXT NOT NULL,
      data TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (run_id) REFERENCES ai_runs(id) ON DELETE CASCADE
    );
    
    CREATE INDEX IF NOT EXISTS idx_events_run_created ON ai_run_events(run_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_events_run_agent ON ai_run_events(run_id, agent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON ai_runs(status);
    CREATE INDEX IF NOT EXISTS idx_runs_created ON ai_runs(created_at DESC);
  `);
  
  // Migration: add workspace_id to ai_runs if it doesn't exist
  const aiRunsInfo = database.prepare("PRAGMA table_info(ai_runs)").all() as { name: string }[];
  const aiRunsColumns = new Set(aiRunsInfo.map(c => c.name));
  
  if (!aiRunsColumns.has("workspace_id")) {
    database.exec("ALTER TABLE ai_runs ADD COLUMN workspace_id TEXT");
    database.exec("CREATE INDEX IF NOT EXISTS idx_runs_workspace ON ai_runs(workspace_id)");
  }
  
  seedAgentProfiles(database);
}

function seedAgentProfiles(database: Database.Database) {
  const existingCount = database.prepare("SELECT COUNT(*) as count FROM agent_profiles").get() as { count: number };
  
  if (existingCount.count > 0) return;
  
  const defaultProfiles = [
    {
      id: "planner",
      role: "planner",
      display_name: "Planner",
      description: "Plans implementation steps and architecture",
      avatar_emoji: "📋",
      color_hex: "#3b82f6",
      model: "codellama",
      max_context_tokens: 128000,
      system_prompt: "You are a senior software architect. Analyze goals and create detailed implementation plans with clear steps, dependencies, and risk assessments.",
      default_temperature: 0.3,
      tools_enabled: JSON.stringify(["files", "search"]),
      risk_tolerance: "conservative",
      verbosity: "high"
    },
    {
      id: "coder",
      role: "coder",
      display_name: "Coder",
      description: "Writes and modifies code",
      avatar_emoji: "💻",
      color_hex: "#22c55e",
      model: "codellama",
      max_context_tokens: 128000,
      system_prompt: "You are an expert software developer. Write clean, efficient, well-documented code. Always output unified diffs for changes.",
      default_temperature: 0.2,
      tools_enabled: JSON.stringify(["files", "db", "tests"]),
      risk_tolerance: "balanced",
      verbosity: "normal"
    },
    {
      id: "reviewer",
      role: "reviewer",
      display_name: "Reviewer",
      description: "Reviews code changes for quality",
      avatar_emoji: "🔍",
      color_hex: "#a855f7",
      model: "codellama",
      max_context_tokens: 128000,
      system_prompt: "You are a code review expert. Analyze code for bugs, security issues, performance problems, and adherence to best practices.",
      default_temperature: 0.4,
      tools_enabled: JSON.stringify(["files"]),
      risk_tolerance: "conservative",
      verbosity: "high"
    },
    {
      id: "testfixer",
      role: "testfixer",
      display_name: "TestFixer",
      description: "Runs tests and fixes failures",
      avatar_emoji: "🧪",
      color_hex: "#eab308",
      model: "codellama",
      max_context_tokens: 128000,
      system_prompt: "You are a test debugging specialist. Analyze test failures, identify root causes, and produce targeted fixes as unified diffs.",
      default_temperature: 0.2,
      tools_enabled: JSON.stringify(["files", "tests"]),
      risk_tolerance: "balanced",
      verbosity: "normal"
    },
    {
      id: "doc",
      role: "doc",
      display_name: "Doc",
      description: "Generates documentation",
      avatar_emoji: "📝",
      color_hex: "#06b6d4",
      model: "codellama",
      max_context_tokens: 128000,
      system_prompt: "You are a technical writer. Create clear, comprehensive documentation including READMEs, API docs, and inline comments.",
      default_temperature: 0.5,
      tools_enabled: JSON.stringify(["files"]),
      risk_tolerance: "conservative",
      verbosity: "high"
    }
  ];
  
  const insertStmt = database.prepare(`
    INSERT INTO agent_profiles (id, role, display_name, description, avatar_emoji, color_hex, model, max_context_tokens, system_prompt, default_temperature, tools_enabled, risk_tolerance, verbosity)
    VALUES (@id, @role, @display_name, @description, @avatar_emoji, @color_hex, @model, @max_context_tokens, @system_prompt, @default_temperature, @tools_enabled, @risk_tolerance, @verbosity)
  `);
  
  for (const profile of defaultProfiles) {
    insertStmt.run(profile);
  }
}

export interface AgentProfile {
  id: string;
  role: string;
  display_name: string;
  description: string | null;
  avatar_emoji: string;
  color_hex: string;
  model: string;
  max_context_tokens: number;
  system_prompt: string | null;
  default_temperature: number;
  tools_enabled: string[];
  risk_tolerance: "conservative" | "balanced" | "aggressive";
  verbosity: "low" | "normal" | "high";
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AiRun {
  id: string;
  run_key: string | null;
  workspace_id: string | null;
  mode: "plan" | "implement" | "test" | "review" | "verify" | "autonomous";
  status: "queued" | "running" | "needs_approval" | "completed" | "failed" | "cancelled";
  goal: string | null;
  agents: string[];
  fast_mode: boolean;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiRunEvent {
  id: number;
  run_id: string;
  agent_id: string | null;
  type: "RUN_STATUS" | "AGENT_STATUS" | "STEP" | "READ_FILE" | "WRITE_FILE" | "TOOL_CALL" | "NOTE" | "ERROR" | "PROPOSE_CHANGESET" | "NEEDS_APPROVAL";
  message: string;
  data: Record<string, unknown>;
  created_at: string;
}

export function getAgentProfiles(): AgentProfile[] {
  const database = getDb();
  const rows = database.prepare("SELECT * FROM agent_profiles ORDER BY id").all() as any[];
  
  return rows.map(row => ({
    ...row,
    tools_enabled: JSON.parse(row.tools_enabled || "[]"),
    enabled: !!row.enabled
  }));
}

export function getAgentProfile(id: string): AgentProfile | null {
  const database = getDb();
  const row = database.prepare("SELECT * FROM agent_profiles WHERE id = ?").get(id) as any;
  
  if (!row) return null;
  
  return {
    ...row,
    tools_enabled: JSON.parse(row.tools_enabled || "[]"),
    enabled: !!row.enabled
  };
}

export function updateAgentProfile(id: string, updates: Partial<Omit<AgentProfile, "id" | "created_at" | "updated_at">>): AgentProfile | null {
  const database = getDb();
  
  const setClauses: string[] = [];
  const values: any[] = [];
  
  if (updates.display_name !== undefined) {
    setClauses.push("display_name = ?");
    values.push(updates.display_name);
  }
  if (updates.model !== undefined) {
    setClauses.push("model = ?");
    values.push(updates.model);
  }
  if (updates.max_context_tokens !== undefined) {
    setClauses.push("max_context_tokens = ?");
    values.push(updates.max_context_tokens);
  }
  if (updates.system_prompt !== undefined) {
    setClauses.push("system_prompt = ?");
    values.push(updates.system_prompt);
  }
  if (updates.default_temperature !== undefined) {
    setClauses.push("default_temperature = ?");
    values.push(updates.default_temperature);
  }
  if (updates.tools_enabled !== undefined) {
    setClauses.push("tools_enabled = ?");
    values.push(JSON.stringify(updates.tools_enabled));
  }
  if (updates.risk_tolerance !== undefined) {
    setClauses.push("risk_tolerance = ?");
    values.push(updates.risk_tolerance);
  }
  if (updates.verbosity !== undefined) {
    setClauses.push("verbosity = ?");
    values.push(updates.verbosity);
  }
  if (updates.enabled !== undefined) {
    setClauses.push("enabled = ?");
    values.push(updates.enabled ? 1 : 0);
  }
  
  if (setClauses.length === 0) {
    return getAgentProfile(id);
  }
  
  setClauses.push("updated_at = datetime('now')");
  values.push(id);
  
  database.prepare(`UPDATE agent_profiles SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);
  
  return getAgentProfile(id);
}

export function createRun(run: Omit<AiRun, "created_at" | "updated_at">): AiRun {
  const database = getDb();
  
  database.prepare(`
    INSERT INTO ai_runs (id, run_key, workspace_id, mode, status, goal, agents, fast_mode, created_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    run.id,
    run.run_key,
    run.workspace_id,
    run.mode,
    run.status,
    run.goal,
    JSON.stringify(run.agents),
    run.fast_mode ? 1 : 0,
    run.created_by_user_id
  );
  
  return getRun(run.id)!;
}

export function getRun(id: string): AiRun | null {
  const database = getDb();
  const row = database.prepare("SELECT * FROM ai_runs WHERE id = ?").get(id) as any;
  
  if (!row) return null;
  
  return {
    ...row,
    agents: JSON.parse(row.agents || "[]"),
    fast_mode: !!row.fast_mode
  };
}

export function getRunByKey(runKey: string): AiRun | null {
  const database = getDb();
  const row = database.prepare("SELECT * FROM ai_runs WHERE run_key = ?").get(runKey) as any;
  
  if (!row) return null;
  
  return {
    ...row,
    agents: JSON.parse(row.agents || "[]"),
    fast_mode: !!row.fast_mode
  };
}

export function updateRunStatus(id: string, status: AiRun["status"]): void {
  const database = getDb();
  database.prepare("UPDATE ai_runs SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
}

export function getRecentRuns(limit: number = 20, workspaceId?: string | null): AiRun[] {
  const database = getDb();
  
  let query = "SELECT * FROM ai_runs";
  const params: (string | number)[] = [];
  
  if (workspaceId !== undefined && workspaceId !== null && workspaceId !== "all") {
    query += " WHERE workspace_id = ?";
    params.push(workspaceId);
  }
  
  query += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);
  
  const rows = database.prepare(query).all(...params) as any[];
  
  return rows.map(row => ({
    ...row,
    agents: JSON.parse(row.agents || "[]"),
    fast_mode: !!row.fast_mode
  }));
}

export function addRunEvent(event: Omit<AiRunEvent, "id" | "created_at">): AiRunEvent {
  const database = getDb();
  
  const result = database.prepare(`
    INSERT INTO ai_run_events (run_id, agent_id, type, message, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    event.run_id,
    event.agent_id,
    event.type,
    event.message,
    JSON.stringify(event.data)
  );
  
  return getRunEvent(result.lastInsertRowid as number)!;
}

export function getRunEvent(id: number): AiRunEvent | null {
  const database = getDb();
  const row = database.prepare("SELECT * FROM ai_run_events WHERE id = ?").get(id) as any;
  
  if (!row) return null;
  
  return {
    ...row,
    data: JSON.parse(row.data || "{}")
  };
}

export function getRunEvents(runId: string, options: { cursor?: number; limit?: number } = {}): AiRunEvent[] {
  const database = getDb();
  const { cursor, limit = 100 } = options;
  
  let query = "SELECT * FROM ai_run_events WHERE run_id = ?";
  const params: (string | number)[] = [runId];
  
  if (cursor !== undefined) {
    query += " AND id > ?";
    params.push(cursor);
  }
  
  query += " ORDER BY id ASC LIMIT ?";
  params.push(limit);
  
  const rows = database.prepare(query).all(...params) as any[];
  
  return rows.map(row => ({
    ...row,
    data: JSON.parse(row.data || "{}")
  }));
}

export function getLatestAgentStatuses(runId: string): Map<string, { status: string; message: string; created_at: string }> {
  const database = getDb();
  
  const rows = database.prepare(`
    SELECT agent_id, message, data, created_at
    FROM ai_run_events
    WHERE run_id = ? AND type = 'AGENT_STATUS' AND agent_id IS NOT NULL
    ORDER BY id DESC
  `).all(runId) as any[];
  
  const statuses = new Map<string, { status: string; message: string; created_at: string }>();
  
  for (const row of rows) {
    if (!statuses.has(row.agent_id)) {
      const data = JSON.parse(row.data || "{}");
      statuses.set(row.agent_id, {
        status: data.status || "idle",
        message: row.message,
        created_at: row.created_at
      });
    }
  }
  
  return statuses;
}

export function getLatestEventPerAgent(runId: string): Map<string, AiRunEvent> {
  const database = getDb();
  
  const rows = database.prepare(`
    SELECT e1.*
    FROM ai_run_events e1
    INNER JOIN (
      SELECT agent_id, MAX(id) as max_id
      FROM ai_run_events
      WHERE run_id = ? AND agent_id IS NOT NULL
      GROUP BY agent_id
    ) e2 ON e1.id = e2.max_id
  `).all(runId) as any[];
  
  const events = new Map<string, AiRunEvent>();
  
  for (const row of rows) {
    events.set(row.agent_id, {
      ...row,
      data: JSON.parse(row.data || "{}")
    });
  }
  
  return events;
}

export function closeAiDb() {
  if (db) {
    db.close();
    db = null;
  }
}
