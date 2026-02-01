import { WebSocketServer, WebSocket } from "ws";
import { spawn, IPty } from "node-pty";
import { Server as HttpServer } from "http";
import { log } from "./index";

interface ShellSession {
  pty: IPty;
  ws: WebSocket;
  createdAt: Date;
}

const sessions = new Map<string, ShellSession>();

function getEffectiveEnv(): "DEV" | "PROD" {
  const simpleaideEnv = process.env.SIMPLEAIDE_ENV?.toLowerCase();
  if (simpleaideEnv === "prod" || simpleaideEnv === "production") {
    return "PROD";
  }
  const nodeEnv = process.env.NODE_ENV?.toLowerCase();
  if (nodeEnv === "production") {
    return "PROD";
  }
  return "DEV";
}

export function setupShellWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({ 
    server,
    path: "/api/shell/ws"
  });

  wss.on("connection", (ws, req) => {
    const sessionId = `shell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const isProd = getEffectiveEnv() === "PROD";

    log(`Shell WebSocket connected: ${sessionId} (env: ${isProd ? "PROD" : "DEV"})`, "shell");

    if (isProd) {
      ws.send(JSON.stringify({
        type: "error",
        message: "Shell access is disabled in production mode"
      }));
      ws.close(1008, "Shell disabled in PROD");
      return;
    }

    const shell = process.env.SHELL || "/bin/bash";
    const cwd = process.cwd();

    let pty: IPty;
    try {
      pty = spawn(shell, [], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        } as Record<string, string>,
      });
    } catch (err) {
      log(`Failed to spawn PTY: ${err}`, "shell");
      ws.send(JSON.stringify({
        type: "error",
        message: `Failed to spawn shell: ${err}`
      }));
      ws.close(1011, "PTY spawn failed");
      return;
    }

    sessions.set(sessionId, {
      pty,
      ws,
      createdAt: new Date()
    });

    log(`PTY spawned: pid=${pty.pid}`, "shell");

    ws.send(JSON.stringify({
      type: "ready",
      sessionId,
      pid: pty.pid
    }));

    pty.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "output",
          data
        }));
      }
    });

    pty.onExit(({ exitCode, signal }) => {
      log(`PTY exited: code=${exitCode}, signal=${signal}`, "shell");
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "exit",
          exitCode,
          signal
        }));
        ws.close(1000, "PTY exited");
      }
      sessions.delete(sessionId);
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        switch (msg.type) {
          case "input":
            if (typeof msg.data === "string") {
              pty.write(msg.data);
            }
            break;
          
          case "resize":
            if (typeof msg.cols === "number" && typeof msg.rows === "number") {
              pty.resize(Math.max(1, msg.cols), Math.max(1, msg.rows));
              log(`PTY resized: ${msg.cols}x${msg.rows}`, "shell");
            }
            break;

          case "ping":
            ws.send(JSON.stringify({ type: "pong" }));
            break;
        }
      } catch (err) {
        log(`Invalid shell message: ${err}`, "shell");
      }
    });

    ws.on("close", () => {
      log(`Shell WebSocket closed: ${sessionId}`, "shell");
      const session = sessions.get(sessionId);
      if (session) {
        try {
          session.pty.kill();
        } catch (err) {
        }
        sessions.delete(sessionId);
      }
    });

    ws.on("error", (err) => {
      log(`Shell WebSocket error: ${err}`, "shell");
    });
  });

  log("Shell WebSocket server initialized", "shell");
  return wss;
}

export function getActiveSessions(): number {
  return sessions.size;
}
