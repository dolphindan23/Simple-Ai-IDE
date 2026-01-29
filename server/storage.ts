import { type User, type InsertUser, type Task, type CreateTask, type TaskMode, type TaskStatus } from "@shared/schema";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Task operations
  createTask(data: CreateTask): Promise<Task>;
  getTask(id: string): Promise<Task | undefined>;
  updateTask(id: string, updates: Partial<Task>): Promise<Task | undefined>;
  getTaskLogs(id: string): string[];
  addTaskLog(id: string, log: string): void;
  getTaskEventEmitter(id: string): EventEmitter;
  
  // Artifact operations
  setArtifact(taskId: string, name: string, content: string): void;
  getArtifact(taskId: string, name: string): string | undefined;
  listArtifacts(taskId: string): string[];
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private tasks: Map<string, Task>;
  private taskLogs: Map<string, string[]>;
  private taskEmitters: Map<string, EventEmitter>;
  private artifacts: Map<string, Map<string, string>>;

  constructor() {
    this.users = new Map();
    this.tasks = new Map();
    this.taskLogs = new Map();
    this.taskEmitters = new Map();
    this.artifacts = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async createTask(data: CreateTask): Promise<Task> {
    const id = randomUUID();
    const task: Task = {
      id,
      repoPath: data.repoPath || ".",
      goal: data.goal,
      mode: data.mode || "implement",
      status: "queued",
      createdAt: new Date().toISOString(),
    };
    this.tasks.set(id, task);
    this.taskLogs.set(id, []);
    this.taskEmitters.set(id, new EventEmitter());
    this.artifacts.set(id, new Map());
    return task;
  }

  async getTask(id: string): Promise<Task | undefined> {
    return this.tasks.get(id);
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task | undefined> {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    
    const updated = { ...task, ...updates };
    this.tasks.set(id, updated);
    return updated;
  }

  getTaskLogs(id: string): string[] {
    return this.taskLogs.get(id) || [];
  }

  addTaskLog(id: string, log: string): void {
    const logs = this.taskLogs.get(id);
    if (logs) {
      logs.push(log);
      const emitter = this.taskEmitters.get(id);
      if (emitter) {
        emitter.emit("log", log);
      }
    }
  }

  getTaskEventEmitter(id: string): EventEmitter {
    let emitter = this.taskEmitters.get(id);
    if (!emitter) {
      emitter = new EventEmitter();
      this.taskEmitters.set(id, emitter);
    }
    return emitter;
  }

  setArtifact(taskId: string, name: string, content: string): void {
    let taskArtifacts = this.artifacts.get(taskId);
    if (!taskArtifacts) {
      taskArtifacts = new Map();
      this.artifacts.set(taskId, taskArtifacts);
    }
    taskArtifacts.set(name, content);
  }

  getArtifact(taskId: string, name: string): string | undefined {
    const taskArtifacts = this.artifacts.get(taskId);
    if (!taskArtifacts) return undefined;
    return taskArtifacts.get(name);
  }

  listArtifacts(taskId: string): string[] {
    const taskArtifacts = this.artifacts.get(taskId);
    if (!taskArtifacts) return [];
    return Array.from(taskArtifacts.keys());
  }
}

export const storage = new MemStorage();
