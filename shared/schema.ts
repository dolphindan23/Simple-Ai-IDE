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
export type TaskMode = "plan" | "implement" | "review" | "test";
export type TaskStatus = "queued" | "running" | "done" | "error";

// Task schema for in-memory storage
export const taskSchema = z.object({
  id: z.string(),
  repoPath: z.string(),
  goal: z.string(),
  mode: z.enum(["plan", "implement", "review", "test"]),
  status: z.enum(["queued", "running", "done", "error"]),
  createdAt: z.string(),
  error: z.string().optional(),
});

export type Task = z.infer<typeof taskSchema>;

export const createTaskSchema = z.object({
  repoPath: z.string().default("."),
  goal: z.string().min(1, "Goal is required"),
  mode: z.enum(["plan", "implement", "review", "test"]).default("implement"),
});

export type CreateTask = z.infer<typeof createTaskSchema>;

// Artifact types
export interface Artifact {
  name: string;
  content: string;
  type: "plan" | "diff" | "review" | "test" | "log";
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
