import Database from "better-sqlite3";
import * as path from "path";
import { getCapsulesDbPath } from "../config/paths";

const DB_PATH = getCapsulesDbPath();
let db: Database.Database | null = null;

export function getCapsulesDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initializeTables(db);
  }
  return db;
}

function initializeTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      model_used TEXT,
      git_checkpoint_before TEXT,
      patch_applied TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    
    CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);

    CREATE TABLE IF NOT EXISTS run_capsules (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES agent_runs(id),
      workspace_path TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      immutable_paths TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tool_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      input TEXT,
      output TEXT,
      success INTEGER DEFAULT 1,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    
    CREATE INDEX IF NOT EXISTS idx_audit_run ON tool_audit_log(run_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS project_index USING fts5(
      project_id,
      file_path,
      chunk_text,
      language,
      start_line,
      end_line,
      tokenize='porter'
    );

    CREATE TABLE IF NOT EXISTS index_meta (
      project_id TEXT PRIMARY KEY,
      last_indexed TEXT,
      file_count INTEGER DEFAULT 0,
      chunk_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS project_remotes (
      project_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      remote_url TEXT NOT NULL,
      default_branch TEXT,
      auth_ref TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_fetched_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_project_remotes_provider ON project_remotes(provider);

    CREATE TABLE IF NOT EXISTS project_git_ops (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      op TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      stage TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      ended_at TEXT,
      log_path TEXT,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_git_ops_project ON project_git_ops(project_id, created_at DESC);
  `);
  
  // Migration: add new columns to agent_runs if they don't exist
  const tableInfo = db.prepare("PRAGMA table_info(agent_runs)").all() as { name: string }[];
  const existingColumns = new Set(tableInfo.map(c => c.name));
  
  if (!existingColumns.has("proof_policy_json")) {
    db.exec("ALTER TABLE agent_runs ADD COLUMN proof_policy_json TEXT");
  }
  if (!existingColumns.has("proof_results_json")) {
    db.exec("ALTER TABLE agent_runs ADD COLUMN proof_results_json TEXT");
  }
  if (!existingColumns.has("template_apply_json")) {
    db.exec("ALTER TABLE agent_runs ADD COLUMN template_apply_json TEXT");
  }
  
  const gitOpsInfo = db.prepare("PRAGMA table_info(project_git_ops)").all() as { name: string }[];
  const gitOpsColumns = new Set(gitOpsInfo.map(c => c.name));
  
  if (!gitOpsColumns.has("stage")) {
    db.exec("ALTER TABLE project_git_ops ADD COLUMN stage TEXT");
  }
}

export interface AgentRun {
  id: string;
  project_id: string;
  status: string;
  model_used?: string | null;
  git_checkpoint_before?: string | null;
  patch_applied?: string | null;
  proof_policy_json?: string | null;
  proof_results_json?: string | null;
  template_apply_json?: string | null;
  created_at?: string;
  updated_at?: string;
}

export function createAgentRun(run: Partial<AgentRun> & { id: string; project_id: string }): AgentRun {
  const db = getCapsulesDb();
  const stmt = db.prepare(`
    INSERT INTO agent_runs (id, project_id, status, model_used, git_checkpoint_before)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    run.id,
    run.project_id,
    run.status || "pending",
    run.model_used || null,
    run.git_checkpoint_before || null
  );
  
  return getAgentRun(run.id)!;
}

export function getAgentRun(runId: string): AgentRun | null {
  const db = getCapsulesDb();
  const stmt = db.prepare("SELECT * FROM agent_runs WHERE id = ?");
  return stmt.get(runId) as AgentRun | null;
}

export function listAgentRuns(projectId: string, limit = 50): AgentRun[] {
  const db = getCapsulesDb();
  const stmt = db.prepare(`
    SELECT * FROM agent_runs 
    WHERE project_id = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `);
  return stmt.all(projectId, limit) as AgentRun[];
}

export function updateAgentRun(runId: string, updates: Partial<AgentRun>): void {
  const db = getCapsulesDb();
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.status !== undefined) {
    fields.push("status = ?");
    values.push(updates.status);
  }
  if (updates.patch_applied !== undefined) {
    fields.push("patch_applied = ?");
    values.push(updates.patch_applied);
  }
  if (updates.git_checkpoint_before !== undefined) {
    fields.push("git_checkpoint_before = ?");
    values.push(updates.git_checkpoint_before);
  }
  if (updates.proof_policy_json !== undefined) {
    fields.push("proof_policy_json = ?");
    values.push(updates.proof_policy_json);
  }
  if (updates.proof_results_json !== undefined) {
    fields.push("proof_results_json = ?");
    values.push(updates.proof_results_json);
  }
  if (updates.template_apply_json !== undefined) {
    fields.push("template_apply_json = ?");
    values.push(updates.template_apply_json);
  }
  
  if (fields.length === 0) return;
  
  fields.push("updated_at = datetime('now')");
  values.push(runId);
  
  const stmt = db.prepare(`UPDATE agent_runs SET ${fields.join(", ")} WHERE id = ?`);
  stmt.run(...values);
}

export interface ToolAuditEntry {
  id?: number;
  run_id: string;
  tool_name: string;
  input?: string;
  output?: string;
  success?: number;
  error_message?: string;
  created_at?: string;
}

export function logToolCall(entry: ToolAuditEntry): void {
  const db = getCapsulesDb();
  const stmt = db.prepare(`
    INSERT INTO tool_audit_log (run_id, tool_name, input, output, success, error_message)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    entry.run_id,
    entry.tool_name,
    entry.input || null,
    entry.output || null,
    entry.success ?? 1,
    entry.error_message || null
  );
}

export function listToolAuditLog(runId: string, limit = 100): ToolAuditEntry[] {
  const db = getCapsulesDb();
  const stmt = db.prepare(`
    SELECT * FROM tool_audit_log 
    WHERE run_id = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `);
  return stmt.all(runId, limit) as ToolAuditEntry[];
}

export interface IndexChunk {
  project_id: string;
  file_path: string;
  chunk_text: string;
  language: string;
  start_line: number;
  end_line: number;
}

export function insertChunks(chunks: IndexChunk[]): void {
  const db = getCapsulesDb();
  const stmt = db.prepare(`
    INSERT INTO project_index (project_id, file_path, chunk_text, language, start_line, end_line)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((items: IndexChunk[]) => {
    for (const chunk of items) {
      stmt.run(
        chunk.project_id,
        chunk.file_path,
        chunk.chunk_text,
        chunk.language,
        chunk.start_line,
        chunk.end_line
      );
    }
  });
  
  insertMany(chunks);
}

export function clearProjectIndex(projectId: string): void {
  const db = getCapsulesDb();
  db.prepare("DELETE FROM project_index WHERE project_id = ?").run(projectId);
}

export function searchChunks(projectId: string, query: string, limit = 20): IndexChunk[] {
  const db = getCapsulesDb();
  const stmt = db.prepare(`
    SELECT project_id, file_path, chunk_text, language, start_line, end_line
    FROM project_index
    WHERE project_id = ? AND project_index MATCH ?
    ORDER BY rank
    LIMIT ?
  `);
  return stmt.all(projectId, query, limit) as IndexChunk[];
}

export function updateIndexMeta(projectId: string, fileCount: number, chunkCount: number): void {
  const db = getCapsulesDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO index_meta (project_id, last_indexed, file_count, chunk_count)
    VALUES (?, datetime('now'), ?, ?)
  `);
  stmt.run(projectId, fileCount, chunkCount);
}

export function getIndexMeta(projectId: string): { last_indexed: string; file_count: number; chunk_count: number } | null {
  const db = getCapsulesDb();
  const stmt = db.prepare("SELECT last_indexed, file_count, chunk_count FROM index_meta WHERE project_id = ?");
  return stmt.get(projectId) as any;
}

export interface ProjectRemote {
  project_id: string;
  provider: string;
  remote_url: string;
  default_branch?: string | null;
  auth_ref?: string | null;
  created_at?: string;
  last_fetched_at?: string | null;
}

export function createProjectRemote(remote: ProjectRemote): void {
  const db = getCapsulesDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO project_remotes 
    (project_id, provider, remote_url, default_branch, auth_ref, last_fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    remote.project_id,
    remote.provider,
    remote.remote_url,
    remote.default_branch || null,
    remote.auth_ref || null,
    remote.last_fetched_at || null
  );
}

export function getProjectRemote(projectId: string): ProjectRemote | null {
  const db = getCapsulesDb();
  const stmt = db.prepare("SELECT * FROM project_remotes WHERE project_id = ?");
  return stmt.get(projectId) as ProjectRemote | null;
}

export function updateProjectRemoteLastFetched(projectId: string): void {
  const db = getCapsulesDb();
  db.prepare("UPDATE project_remotes SET last_fetched_at = datetime('now') WHERE project_id = ?").run(projectId);
}

export type GitOpType = "clone" | "pull" | "checkout" | "submodule_update";
export type GitOpStatus = "queued" | "running" | "succeeded" | "failed";

export type GitOpStage = 
  | "validate_url"
  | "clone_start"
  | "clone_done"
  | "bootstrap_start"
  | "bootstrap_done"
  | "index_build_start"
  | "index_build_done"
  | "fetch_start"
  | "pull_start"
  | "pull_done";

export interface ProjectGitOp {
  id: string;
  project_id: string;
  op: GitOpType;
  status: GitOpStatus;
  stage?: GitOpStage | null;
  created_at?: string;
  started_at?: string | null;
  ended_at?: string | null;
  log_path?: string | null;
  error?: string | null;
}

export function createGitOp(op: { id: string; project_id: string; op: GitOpType }): ProjectGitOp {
  const db = getCapsulesDb();
  const stmt = db.prepare(`
    INSERT INTO project_git_ops (id, project_id, op, status)
    VALUES (?, ?, ?, 'queued')
  `);
  stmt.run(op.id, op.project_id, op.op);
  return getGitOp(op.id)!;
}

export function getGitOp(opId: string): ProjectGitOp | null {
  const db = getCapsulesDb();
  const stmt = db.prepare("SELECT * FROM project_git_ops WHERE id = ?");
  return stmt.get(opId) as ProjectGitOp | null;
}

export function listGitOps(projectId: string, limit = 20): ProjectGitOp[] {
  const db = getCapsulesDb();
  const stmt = db.prepare(`
    SELECT * FROM project_git_ops 
    WHERE project_id = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `);
  return stmt.all(projectId, limit) as ProjectGitOp[];
}

export function updateGitOp(opId: string, updates: Partial<Pick<ProjectGitOp, "status" | "stage" | "started_at" | "ended_at" | "log_path" | "error">>): void {
  const db = getCapsulesDb();
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.status !== undefined) {
    fields.push("status = ?");
    values.push(updates.status);
  }
  if (updates.stage !== undefined) {
    fields.push("stage = ?");
    values.push(updates.stage);
  }
  if (updates.started_at !== undefined) {
    fields.push("started_at = ?");
    values.push(updates.started_at);
  }
  if (updates.ended_at !== undefined) {
    fields.push("ended_at = ?");
    values.push(updates.ended_at);
  }
  if (updates.log_path !== undefined) {
    fields.push("log_path = ?");
    values.push(updates.log_path);
  }
  if (updates.error !== undefined) {
    fields.push("error = ?");
    values.push(updates.error);
  }
  
  if (fields.length === 0) return;
  values.push(opId);
  
  const stmt = db.prepare(`UPDATE project_git_ops SET ${fields.join(", ")} WHERE id = ?`);
  stmt.run(...values);
}
