import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import {
  type TaskRun,
  type RunMetadata,
  type StepRun,
  type StepType,
  type StepInput,
  type CreateRun,
  type RunStatus,
  type StepStatus,
  runMetadataSchema,
  stepRunSchema,
} from "@shared/schema";

const SIMPLEAIDE_DIR = ".simpleaide";
const RUNS_DIR = "runs";

function getRunsDir(): string {
  return path.join(process.cwd(), SIMPLEAIDE_DIR, RUNS_DIR);
}

function getRunDir(runId: string): string {
  return path.join(getRunsDir(), runId);
}

function getStepDir(runId: string, stepNumber: number, stepType: StepType): string {
  const paddedNum = String(stepNumber).padStart(2, "0");
  return path.join(getRunDir(runId), `${paddedNum}_${stepType}`);
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
}

export class RunsStorage {
  constructor() {
    ensureDir(getRunsDir());
  }

  async createRun(data: CreateRun): Promise<TaskRun> {
    const id = randomUUID();
    const runDir = getRunDir(id);
    ensureDir(runDir);

    const metadata: RunMetadata = {
      id,
      goal: data.goal,
      repoPath: data.repoPath || ".",
      startedAt: new Date().toISOString(),
      status: "pending",
      stepCount: 0,
    };

    this.saveRunMetadata(id, metadata);

    return {
      metadata,
      steps: [],
    };
  }

  async getRun(runId: string): Promise<TaskRun | undefined> {
    const runDir = getRunDir(runId);
    const metadataPath = path.join(runDir, "run.json");

    if (!fs.existsSync(metadataPath)) {
      return undefined;
    }

    try {
      const metadataRaw = fs.readFileSync(metadataPath, "utf-8");
      const metadata = runMetadataSchema.parse(JSON.parse(metadataRaw));
      const steps = this.loadSteps(runId);

      return { metadata, steps };
    } catch (error) {
      console.error(`Error loading run ${runId}:`, error);
      return undefined;
    }
  }

  async listRuns(): Promise<RunMetadata[]> {
    const runsDir = getRunsDir();
    if (!fs.existsSync(runsDir)) {
      return [];
    }

    const entries = fs.readdirSync(runsDir, { withFileTypes: true });
    const runs: RunMetadata[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const metadataPath = path.join(runsDir, entry.name, "run.json");
        if (fs.existsSync(metadataPath)) {
          try {
            const raw = fs.readFileSync(metadataPath, "utf-8");
            const metadata = runMetadataSchema.parse(JSON.parse(raw));
            runs.push(metadata);
          } catch (error) {
            console.error(`Error loading run metadata for ${entry.name}:`, error);
          }
        }
      }
    }

    return runs.sort((a, b) => 
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  async updateRunStatus(runId: string, status: RunStatus, errorMessage?: string): Promise<void> {
    const run = await this.getRun(runId);
    if (!run) return;

    run.metadata.status = status;
    if (status === "completed" || status === "failed" || status === "cancelled") {
      run.metadata.completedAt = new Date().toISOString();
    }
    if (errorMessage) {
      run.metadata.errorMessage = errorMessage;
    }

    this.saveRunMetadata(runId, run.metadata);
  }

  async createStep(
    runId: string,
    stepType: StepType,
    input: StepInput
  ): Promise<StepRun> {
    const run = await this.getRun(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }

    const stepNumber = run.metadata.stepCount + 1;
    const stepId = randomUUID();
    const stepDir = getStepDir(runId, stepNumber, stepType);
    ensureDir(stepDir);

    const step: StepRun = {
      id: stepId,
      runId,
      stepNumber,
      stepType,
      stepName: `${stepNumber.toString().padStart(2, "0")}_${stepType}`,
      input,
      statusMeta: {
        status: "pending",
      },
      artifactNames: [],
    };

    fs.writeFileSync(
      path.join(stepDir, "input.json"),
      JSON.stringify(input, null, 2),
      { mode: 0o600 }
    );

    fs.writeFileSync(
      path.join(stepDir, "status.json"),
      JSON.stringify(step.statusMeta, null, 2),
      { mode: 0o600 }
    );

    run.metadata.stepCount = stepNumber;
    this.saveRunMetadata(runId, run.metadata);

    return step;
  }

  async updateStepStatus(
    runId: string,
    stepNumber: number,
    stepType: StepType,
    status: StepStatus,
    durationMs?: number,
    errorMessage?: string
  ): Promise<void> {
    const stepDir = getStepDir(runId, stepNumber, stepType);
    const statusPath = path.join(stepDir, "status.json");

    // Load existing status to preserve startedAt
    let existingStatus: any = {};
    if (fs.existsSync(statusPath)) {
      try {
        existingStatus = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
      } catch {
        // If parse fails, start fresh
      }
    }

    const statusMeta = {
      ...existingStatus,
      status,
      startedAt: status === "running" && !existingStatus.startedAt 
        ? new Date().toISOString() 
        : existingStatus.startedAt,
      completedAt: ["passed", "failed", "skipped"].includes(status) 
        ? new Date().toISOString() 
        : existingStatus.completedAt,
      durationMs: durationMs ?? existingStatus.durationMs,
      errorMessage: errorMessage ?? existingStatus.errorMessage,
    };

    fs.writeFileSync(statusPath, JSON.stringify(statusMeta, null, 2), { mode: 0o600 });
  }

  async saveStepArtifact(
    runId: string,
    stepNumber: number,
    stepType: StepType,
    artifactName: string,
    content: string
  ): Promise<void> {
    const stepDir = getStepDir(runId, stepNumber, stepType);
    ensureDir(stepDir);
    
    const artifactPath = path.join(stepDir, artifactName);
    fs.writeFileSync(artifactPath, content, { mode: 0o600 });
  }

  async getStepArtifact(
    runId: string,
    stepNumber: number,
    stepType: StepType,
    artifactName: string
  ): Promise<string | undefined> {
    const stepDir = getStepDir(runId, stepNumber, stepType);
    const artifactPath = path.join(stepDir, artifactName);

    if (!fs.existsSync(artifactPath)) {
      return undefined;
    }

    return fs.readFileSync(artifactPath, "utf-8");
  }

  async listStepArtifacts(
    runId: string,
    stepNumber: number,
    stepType: StepType
  ): Promise<string[]> {
    const stepDir = getStepDir(runId, stepNumber, stepType);
    
    if (!fs.existsSync(stepDir)) {
      return [];
    }

    const files = fs.readdirSync(stepDir);
    return files.filter(f => f !== "input.json" && f !== "status.json");
  }

  async deleteStepsFrom(runId: string, fromStep: number): Promise<void> {
    const run = await this.getRun(runId);
    if (!run) return;

    const runDir = getRunDir(runId);
    const entries = fs.readdirSync(runDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const match = entry.name.match(/^(\d+)_/);
        if (match) {
          const stepNum = parseInt(match[1], 10);
          if (stepNum >= fromStep) {
            const stepPath = path.join(runDir, entry.name);
            fs.rmSync(stepPath, { recursive: true, force: true });
          }
        }
      }
    }

    run.metadata.stepCount = fromStep - 1;
    run.metadata.status = "running";
    run.metadata.completedAt = undefined;
    run.metadata.errorMessage = undefined;
    this.saveRunMetadata(runId, run.metadata);
  }

  private saveRunMetadata(runId: string, metadata: RunMetadata): void {
    const runDir = getRunDir(runId);
    ensureDir(runDir);
    const metadataPath = path.join(runDir, "run.json");
    fs.writeFileSync(
      metadataPath,
      JSON.stringify(metadata, null, 2),
      { mode: 0o600 }
    );
    // Ensure file permissions are set correctly (in case file already existed)
    try {
      fs.chmodSync(metadataPath, 0o600);
    } catch {
      // Ignore chmod errors on some systems
    }
  }

  private loadSteps(runId: string): StepRun[] {
    const runDir = getRunDir(runId);
    if (!fs.existsSync(runDir)) {
      return [];
    }

    const entries = fs.readdirSync(runDir, { withFileTypes: true });
    const steps: StepRun[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const match = entry.name.match(/^(\d+)_(\w+)$/);
        if (match) {
          const stepNumber = parseInt(match[1], 10);
          const stepType = match[2] as StepType;
          const stepDir = path.join(runDir, entry.name);

          try {
            const inputPath = path.join(stepDir, "input.json");
            const statusPath = path.join(stepDir, "status.json");

            const input = fs.existsSync(inputPath)
              ? JSON.parse(fs.readFileSync(inputPath, "utf-8"))
              : {};

            const statusMeta = fs.existsSync(statusPath)
              ? JSON.parse(fs.readFileSync(statusPath, "utf-8"))
              : { status: "pending" };

            const artifacts = fs.readdirSync(stepDir)
              .filter(f => f !== "input.json" && f !== "status.json");

            steps.push({
              id: `${runId}-step-${stepNumber}`,
              runId,
              stepNumber,
              stepType,
              stepName: entry.name,
              input,
              statusMeta,
              artifactNames: artifacts,
            });
          } catch (error) {
            console.error(`Error loading step ${entry.name}:`, error);
          }
        }
      }
    }

    return steps.sort((a, b) => a.stepNumber - b.stepNumber);
  }
}

export const runsStorage = new RunsStorage();
