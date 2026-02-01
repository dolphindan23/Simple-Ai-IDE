export type PullJobStatus = "queued" | "pulling" | "verifying" | "done" | "error" | "canceled";

export type PullJob = {
  id: string;
  model: string;
  status: PullJobStatus;
  progress: number;
  downloadedBytes?: number;
  totalBytes?: number;
  message?: string;
  error?: string;
  startedAt: number;
  updatedAt: number;
};

const jobs = new Map<string, PullJob>();

export function createJob(id: string, model: string): PullJob {
  const now = Date.now();
  const job: PullJob = { id, model, status: "queued", progress: 0, startedAt: now, updatedAt: now };
  jobs.set(id, job);
  return job;
}

export function updateJob(id: string, patch: Partial<PullJob>): void {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: Date.now() });
}

export function getJob(id: string): PullJob | null {
  return jobs.get(id) || null;
}

export function listJobs(): PullJob[] {
  return Array.from(jobs.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function removeJob(id: string): boolean {
  return jobs.delete(id);
}

export function clearCompletedJobs(): void {
  for (const [id, job] of jobs.entries()) {
    if (job.status === "done" || job.status === "error" || job.status === "canceled") {
      jobs.delete(id);
    }
  }
}
