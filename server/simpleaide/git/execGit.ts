import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

export interface ExecGitOptions {
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  pat?: string;
  env?: Record<string, string>;
}

export interface ExecGitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_OUTPUT = 2 * 1024 * 1024;

export async function execGit(
  args: string[],
  options: ExecGitOptions = {}
): Promise<ExecGitResult> {
  const {
    cwd = process.cwd(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxOutputBytes = DEFAULT_MAX_OUTPUT,
    pat,
    env: extraEnv = {},
  } = options;

  let askpassPath: string | undefined;
  let patFilePath: string | undefined;

  const baseEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
    ...extraEnv,
  };

  if (pat) {
    const tmpDir = os.tmpdir();
    const uniqueId = crypto.randomBytes(8).toString("hex");
    
    patFilePath = path.join(tmpDir, `.gitpat_${uniqueId}`);
    fs.writeFileSync(patFilePath, pat, { mode: 0o600 });
    
    askpassPath = path.join(tmpDir, `.askpass_${uniqueId}.sh`);
    const askpassScript = `#!/bin/sh
case "$1" in
  *[Uu]sername*) echo "x-access-token" ;;
  *[Pp]assword*) cat "${patFilePath}" ;;
  *) cat "${patFilePath}" ;;
esac
`;
    fs.writeFileSync(askpassPath, askpassScript, { mode: 0o700 });
    
    baseEnv.GIT_ASKPASS = askpassPath;
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let totalBytes = 0;

    const proc = spawn("git", args, {
      cwd,
      env: baseEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => {
      const remaining = maxOutputBytes - totalBytes;
      if (remaining > 0) {
        const toAdd = chunk.slice(0, remaining);
        stdout += toAdd.toString();
        totalBytes += toAdd.length;
        if (chunk.length > remaining) {
          truncated = true;
        }
      } else {
        truncated = true;
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const remaining = maxOutputBytes - totalBytes;
      if (remaining > 0) {
        const toAdd = chunk.slice(0, remaining);
        stderr += toAdd.toString();
        totalBytes += toAdd.length;
        if (chunk.length > remaining) {
          truncated = true;
        }
      } else {
        truncated = true;
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      
      if (askpassPath && fs.existsSync(askpassPath)) {
        try { fs.unlinkSync(askpassPath); } catch {}
      }
      if (patFilePath && fs.existsSync(patFilePath)) {
        try { fs.unlinkSync(patFilePath); } catch {}
      }
      
      const cleanedStdout = redactSecrets(stdout);
      const cleanedStderr = redactSecrets(stderr);

      resolve({
        exitCode: code ?? -1,
        stdout: cleanedStdout,
        stderr: cleanedStderr,
        timedOut,
        truncated,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      
      if (askpassPath && fs.existsSync(askpassPath)) {
        try { fs.unlinkSync(askpassPath); } catch {}
      }
      if (patFilePath && fs.existsSync(patFilePath)) {
        try { fs.unlinkSync(patFilePath); } catch {}
      }

      resolve({
        exitCode: -1,
        stdout: "",
        stderr: redactSecrets(err.message),
        timedOut: false,
        truncated: false,
      });
    });
  });
}

function redactSecrets(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/ghp_[A-Za-z0-9]{36}/g, "[REDACTED_GH_TOKEN]");
  cleaned = cleaned.replace(/github_pat_[A-Za-z0-9_]{59,}/g, "[REDACTED_GH_PAT]");
  cleaned = cleaned.replace(/glpat-[A-Za-z0-9\-_]{20,}/g, "[REDACTED_GL_TOKEN]");
  cleaned = cleaned.replace(/gho_[A-Za-z0-9]{36}/g, "[REDACTED_GH_OAUTH]");
  cleaned = cleaned.replace(/https:\/\/[^:]+:[^@]+@/g, "https://[REDACTED]@");
  cleaned = cleaned.replace(/password["\s:=]+[^\s"',]+/gi, "password: [REDACTED]");
  return cleaned;
}

export async function getDefaultBranch(url: string, pat?: string): Promise<string> {
  const result = await execGit(["ls-remote", "--symref", url, "HEAD"], { pat, timeoutMs: 30000 });
  
  if (result.exitCode !== 0) {
    throw new Error(`Failed to get default branch: ${result.stderr}`);
  }
  
  const match = result.stdout.match(/ref: refs\/heads\/(\S+)\s+HEAD/);
  if (match) {
    return match[1];
  }
  
  return "main";
}
