import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Task mode types
export type TaskMode = "plan" | "implement" | "review" | "test" | "verify";
export type TaskStatus = "queued" | "running" | "done" | "error";

// Task schema for in-memory storage
export const taskSchema = z.object({
  id: z.string(),
  repoPath: z.string(),
  goal: z.string(),
  mode: z.enum(["plan", "implement", "review", "test", "verify"]),
  status: z.enum(["queued", "running", "done", "error"]),
  createdAt: z.string(),
  error: z.string().optional(),
  accurateMode: z.boolean().default(false),
});

export type Task = z.infer<typeof taskSchema>;

export const createTaskSchema = z.object({
  repoPath: z.string().default("."),
  goal: z.string().min(1, "Goal is required"),
  mode: z.enum(["plan", "implement", "review", "test", "verify"]).default("implement"),
  accurateMode: z.boolean().default(false),
});

export type CreateTask = z.infer<typeof createTaskSchema>;

// Artifact types
export interface ArtifactMetadata {
  model?: string;
  backend?: string;
  latencyMs?: number;
  timestamp?: string;
}

export interface Artifact {
  name: string;
  content: string;
  type: "plan" | "diff" | "review" | "test" | "log";
  metadata?: ArtifactMetadata;
}

// File tree types
export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
}

// Ollama config
export interface OllamaConfig {
  baseUrl: string;
  model: string;
}

export const defaultOllamaConfig: OllamaConfig = {
  baseUrl: "http://localhost:11434",
  model: "codellama",
};

// Settings types
export const editorSettingsSchema = z.object({
  fontSize: z.number().min(8).max(32).default(14),
  tabSize: z.number().min(1).max(8).default(2),
  wordWrap: z.enum(["on", "off", "wordWrapColumn", "bounded"]).default("on"),
  minimap: z.boolean().default(true),
  lineNumbers: z.enum(["on", "off", "relative"]).default("on"),
  fontFamily: z.string().default("JetBrains Mono, monospace"),
});

export const aiSettingsSchema = z.object({
  autoSave: z.boolean().default(true),
  defaultAction: z.enum(["plan", "implement", "test", "review"]).default("plan"),
  defaultSpeed: z.enum(["fast", "accurate"]).default("fast"),
  showDiffBeforeApply: z.boolean().default(true),
  confirmDestructiveChanges: z.boolean().default(true),
});

// Trust and safety settings for agent code editing
export const trustSettingsSchema = z.object({
  autoFixEnabled: z.boolean().default(false),
  maxFixAttempts: z.number().min(1).max(10).default(3),
  maxFilesPerPatch: z.number().min(1).max(50).default(10),
  maxLinesPerPatch: z.number().min(10).max(5000).default(500),
  sensitivePaths: z.array(z.string()).default([
    "server/**",
    "scripts/**",
    "package.json",
    "package-lock.json",
    "*.config.*",
    ".env*",
    ".simpleaide/**",
  ]),
  verifyAllowlist: z.array(z.string()).default([
    "npm test",
    "npm run test",
    "npm run lint",
    "npm run build",
    "npm run typecheck",
  ]),
});

export type TrustSettings = z.infer<typeof trustSettingsSchema>;

export const generalSettingsSchema = z.object({
  theme: z.enum(["light", "dark", "terminal-noir", "system"]).default("dark"),
  autoSaveDelay: z.number().min(500).max(10000).default(1000),
  showHiddenFiles: z.boolean().default(false),
});

export const integrationSettingsSchema = z.object({
  kaggle: z.object({
    username: z.string().optional(),
    enabled: z.boolean().default(false),
  }).default({}),
  huggingface: z.object({
    enabled: z.boolean().default(false),
  }).default({}),
  ngc: z.object({
    org: z.string().optional(),
    enabled: z.boolean().default(false),
  }).default({}),
});

// AI Agents types
export const authTypeSchema = z.enum(["none", "basic", "bearer"]);
export type AuthType = z.infer<typeof authTypeSchema>;

export const backendConfigSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  authType: authTypeSchema.default("none"),
});

export type BackendConfig = z.infer<typeof backendConfigSchema>;

export const agentRoleSchema = z.enum(["Planner", "Coder", "Reviewer", "TestFixer", "Doc"]);
export type AgentRole = z.infer<typeof agentRoleSchema>;

export const roleConfigSchema = z.object({
  backendId: z.string(),
  model: z.string(),
  temperature: z.number().min(0).max(2).default(0.7),
  numCtx: z.number().min(512).max(131072).default(4096),
});

export type RoleConfig = z.infer<typeof roleConfigSchema>;

export const aiAgentsSettingsSchema = z.object({
  backends: z.array(backendConfigSchema).default([]),
  defaultBackendId: z.string().optional(),
  roles: z.record(agentRoleSchema, roleConfigSchema).default({}),
});

export type AIAgentsSettings = z.infer<typeof aiAgentsSettingsSchema>;

export const settingsSchema = z.object({
  general: generalSettingsSchema.default({}),
  editor: editorSettingsSchema.default({}),
  ai: aiSettingsSchema.default({}),
  integrations: integrationSettingsSchema.default({}),
  aiAgents: aiAgentsSettingsSchema.default({}),
  trust: trustSettingsSchema.default({}),
});

export type EditorSettings = z.infer<typeof editorSettingsSchema>;
export type AISettings = z.infer<typeof aiSettingsSchema>;
export type GeneralSettings = z.infer<typeof generalSettingsSchema>;
export type IntegrationSettings = z.infer<typeof integrationSettingsSchema>;
export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = settingsSchema.parse({});

// ==================== Phase D1: Workflow Engine Types ====================

// Step types for workflow runs
export const stepTypeSchema = z.enum(["plan", "implement", "review", "test", "fix", "verify"]);
export type StepType = z.infer<typeof stepTypeSchema>;

// Danger summary item for dangerous changes
export const dangerItemSchema = z.object({
  file: z.string(),
  reason: z.enum(["delete", "sensitive_path"]),
  pattern: z.string().optional(),
});
export type DangerItem = z.infer<typeof dangerItemSchema>;

// Validation result for patch diffs (enhanced with trust features)
export const patchValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  hunkCount: z.number(),
  fileCount: z.number().default(0),
  lineCount: z.number().default(0),
  requiresConfirmation: z.boolean().default(false),
  confirmationToken: z.string().optional(),
  dangerSummary: z.array(dangerItemSchema).default([]),
});
export type PatchValidationResult = z.infer<typeof patchValidationResultSchema>;

// Verify step result
export const verifyResultSchema = z.object({
  passed: z.boolean(),
  command: z.string(),
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number(),
});
export type VerifyResult = z.infer<typeof verifyResultSchema>;

// Step status
export const stepStatusSchema = z.enum(["pending", "running", "passed", "failed", "skipped"]);
export type StepStatus = z.infer<typeof stepStatusSchema>;

// Run status
export const runStatusSchema = z.enum(["pending", "running", "completed", "failed", "cancelled"]);
export type RunStatus = z.infer<typeof runStatusSchema>;

// Step input - what the step was given
export const stepInputSchema = z.object({
  role: agentRoleSchema.optional(),
  backendId: z.string().optional(),
  model: z.string().optional(),
  filesReferenced: z.array(z.string()).default([]),
  prompt: z.string().optional(),
});
export type StepInput = z.infer<typeof stepInputSchema>;

// Step status metadata
export const stepStatusMetaSchema = z.object({
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  durationMs: z.number().optional(),
  status: stepStatusSchema,
  errorMessage: z.string().optional(),
});
export type StepStatusMeta = z.infer<typeof stepStatusMetaSchema>;

// A single step run within a workflow run
export const stepRunSchema = z.object({
  id: z.string(),
  runId: z.string(),
  stepNumber: z.number(),
  stepType: stepTypeSchema,
  stepName: z.string(),
  input: stepInputSchema,
  statusMeta: stepStatusMetaSchema,
  artifactNames: z.array(z.string()).default([]),
});
export type StepRun = z.infer<typeof stepRunSchema>;

// Run metadata stored in run.json
export const runMetadataSchema = z.object({
  id: z.string(),
  goal: z.string(),
  repoPath: z.string(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  status: runStatusSchema,
  stepCount: z.number().default(0),
  errorMessage: z.string().optional(),
});
export type RunMetadata = z.infer<typeof runMetadataSchema>;

// Full run state including all steps
export const taskRunSchema = z.object({
  metadata: runMetadataSchema,
  steps: z.array(stepRunSchema).default([]),
});
export type TaskRun = z.infer<typeof taskRunSchema>;

// Create run request
export const createRunSchema = z.object({
  goal: z.string().min(1, "Goal is required"),
  repoPath: z.string().default("."),
});
export type CreateRun = z.infer<typeof createRunSchema>;

// Execute step request
export const executeStepSchema = z.object({
  stepType: stepTypeSchema,
  input: stepInputSchema.optional(),
});
export type ExecuteStep = z.infer<typeof executeStepSchema>;

// Rerun request
export const rerunSchema = z.object({
  fromStep: z.number().min(1),
});
export type RerunRequest = z.infer<typeof rerunSchema>;

// ==================== Project Management Types ====================

export const projectSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  path: z.string(),
  createdAt: z.string(),
  lastOpenedAt: z.string().optional(),
});

export type Project = z.infer<typeof projectSchema>;

export const createProjectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(100, "Project name too long"),
});

export type CreateProject = z.infer<typeof createProjectSchema>;

export const activeProjectSchema = z.object({
  projectId: z.string(),
});

export type ActiveProject = z.infer<typeof activeProjectSchema>;
