#!/usr/bin/env node
/**
 * Smoke test: AI visibility pipeline
 * - Connects to running server's SSE stream /api/ai/stream
 * - Triggers a run via POST /api/task/start
 * - Asserts required event types arrive:
 *   AGENT_STATUS(done), READ_FILE, WRITE_FILE, TOOL_CALL, PROPOSE_CHANGESET, STEP(with progress)
 *
 * Usage:
 *   # With server already running:
 *   node script/smoke-ai-visibility.mjs
 *
 *   # With auto-start (spawns server):
 *   START_SERVER=1 node script/smoke-ai-visibility.mjs
 *
 * Env overrides:
 *   BASE_URL=http://localhost:5000
 *   START_SERVER=1  (set to spawn server automatically)
 *   REPO_PATH="/absolute/path/to/repo"
 *   MODE="implement"
 *   GOAL="..."
 *   TIMEOUT_MS=60000
 */

import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";
const START_SERVER = process.env.START_SERVER === "1";
const REPO_PATH = process.env.REPO_PATH ?? process.cwd();
const MODE = process.env.MODE ?? "implement";
const GOAL =
  process.env.GOAL ??
  "SMOKE: Add a trivial comment to .simpleaide/smoke-test.txt and run verification.";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 60000);

// Required events depend on mode
// - plan: only READ_FILE, STEP_PROGRESS, AGENT_STATUS_DONE
// - implement/test/review: full event set
const REQUIRED_BASE = ["AGENT_STATUS_DONE", "STEP_PROGRESS"];
const REQUIRED_IMPLEMENT = ["READ_FILE", "WRITE_FILE", "TOOL_CALL", "PROPOSE_CHANGESET"];

function getRequiredEvents(mode) {
  if (mode === "plan") {
    return new Set([...REQUIRED_BASE, "READ_FILE"]);
  }
  return new Set([...REQUIRED_BASE, ...REQUIRED_IMPLEMENT]);
}

const REQUIRED = getRequiredEvents(MODE);

function log(...args) {
  console.log("[smoke]", new Date().toISOString(), ...args);
}

function fatal(msg) {
  console.error("[smoke] FAIL:", msg);
  process.exit(1);
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  return json;
}

/**
 * Minimal SSE client using fetch + ReadableStream parsing.
 * Handles SimpleAide's event format: { event_type, agent_role, payload, ... }
 */
async function connectSSE(url, onEvent) {
  const res = await fetch(url, { headers: { Accept: "text/event-stream" } });
  if (!res.ok || !res.body) throw new Error(`SSE connect failed: HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);

        const dataLines = chunk
          .split("\n")
          .map((l) => l.trimEnd())
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.replace(/^data:\s?/, ""));

        if (!dataLines.length) continue;

        const dataStr = dataLines.join("\n");
        try {
          const payload = JSON.parse(dataStr);
          onEvent(payload);
        } catch {
          log("Skipping non-JSON SSE data:", dataStr.slice(0, 100));
        }
      }
    }
  })().catch((e) => {
    log(`SSE stream error: ${e?.message ?? e}`);
  });

  return () => {
    try {
      reader.cancel();
    } catch {}
  };
}

function startServer() {
  log("Starting server: npm run dev");
  const child = spawn("npm", ["run", "dev"], {
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "development" },
  });

  child.stdout.on("data", (d) => process.stdout.write(String(d)));
  child.stderr.on("data", (d) => process.stderr.write(String(d)));

  child.on("exit", (code) => {
    if (code !== 0) log(`Server exited with code ${code}`);
  });

  return child;
}

async function waitForHealth() {
  const url = `${BASE_URL}/api/ai/agent-profiles`;
  const start = Date.now();
  log("Waiting for server health...");
  while (Date.now() - start < 30000) {
    try {
      await fetchJson(url);
      return;
    } catch {
      await delay(500);
    }
  }
  fatal(`Server did not become ready in time (${url})`);
}

async function main() {
  let child = null;

  if (START_SERVER) {
    child = startServer();
    process.on("exit", () => child?.kill("SIGTERM"));
    process.on("SIGINT", () => process.exit(1));
    process.on("SIGTERM", () => process.exit(1));
  }

  await waitForHealth();
  log("Server is ready at", BASE_URL);

  const seen = new Set();
  let lastRunId = null;

  const stopSSE = await connectSSE(`${BASE_URL}/api/ai/stream`, (evt) => {
    const eventType = evt?.event_type ?? evt?.type ?? null;
    
    const payload = evt?.payload ?? evt?.data ?? {};
    const agentStatus = payload?.status ?? null;

    if (evt?.run_id) lastRunId = evt.run_id;

    if (eventType === "READ_FILE") {
      seen.add("READ_FILE");
      log("Event: READ_FILE", payload?.path ?? "");
    }
    if (eventType === "WRITE_FILE") {
      seen.add("WRITE_FILE");
      log("Event: WRITE_FILE", payload?.path ?? "");
    }
    if (eventType === "TOOL_CALL") {
      seen.add("TOOL_CALL");
      log("Event: TOOL_CALL", payload?.tool ?? "");
    }
    if (eventType === "PROPOSE_CHANGESET") {
      seen.add("PROPOSE_CHANGESET");
      log("Event: PROPOSE_CHANGESET", payload?.files?.length ?? 0, "files");
    }

    if (eventType === "AGENT_STATUS" && agentStatus === "done") {
      seen.add("AGENT_STATUS_DONE");
      log("Event: AGENT_STATUS done", evt?.agent_role ?? "");
    }

    const stepIndex = payload?.step_index;
    const stepTotal = payload?.step_total;
    if (eventType === "STEP" && Number.isFinite(stepIndex) && Number.isFinite(stepTotal)) {
      seen.add("STEP_PROGRESS");
      log(`Event: STEP [${payload?.phase ?? "?"}] ${stepIndex}/${stepTotal}`, payload?.message ?? "");
    }
  });

  log("Mode:", MODE, "| Required events:", [...REQUIRED].join(", "));
  log("Triggering run:", "goal:", GOAL.slice(0, 50) + "...");
  
  const startRes = await fetchJson(`${BASE_URL}/api/task/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal: GOAL, mode: MODE, repoPath: REPO_PATH }),
  });

  const runId = startRes?.runId ?? startRes?.data?.runId ?? lastRunId;
  log("Triggered run:", runId ?? "(unknown run id)");

  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    let allSeen = true;
    for (const k of REQUIRED) {
      if (!seen.has(k)) {
        allSeen = false;
        break;
      }
    }
    if (allSeen) {
      stopSSE();
      log("");
      log("=".repeat(60));
      log("PASS All required events observed:");
      for (const k of REQUIRED) {
        log(`  [x] ${k}`);
      }
      log("=".repeat(60));
      if (child) child.kill("SIGTERM");
      process.exit(0);
    }
    await delay(250);
  }

  stopSSE();
  const missing = [...REQUIRED].filter((k) => !seen.has(k));
  const seenList = [...seen];
  log("");
  log("=".repeat(60));
  log("FAIL Timed out waiting for events");
  log("Missing:", missing.join(", "));
  log("Seen:", seenList.join(", "));
  log("=".repeat(60));
  if (child) child.kill("SIGTERM");
  process.exit(1);
}

main().catch((e) => fatal(e?.message ?? String(e)));
