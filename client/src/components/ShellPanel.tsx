import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal, RefreshCw, XCircle, AlertTriangle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error" | "prod_disabled";

interface ShellMessage {
  type: "ready" | "output" | "exit" | "error" | "pong";
  data?: string;
  sessionId?: string;
  pid?: number;
  exitCode?: number;
  signal?: number;
  message?: string;
}

export function ShellPanel() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pid, setPid] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus("connecting");
    setErrorMessage(null);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/shell/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
    };

    ws.onmessage = (event) => {
      try {
        const msg: ShellMessage = JSON.parse(event.data);
        
        switch (msg.type) {
          case "ready":
            setStatus("connected");
            setSessionId(msg.sessionId || null);
            setPid(msg.pid || null);
            xtermRef.current?.clear();
            break;
          
          case "output":
            if (msg.data) {
              xtermRef.current?.write(msg.data);
            }
            break;
          
          case "exit":
            setStatus("disconnected");
            xtermRef.current?.writeln(`\r\n\x1b[33m[Process exited with code ${msg.exitCode}]\x1b[0m`);
            break;
          
          case "error":
            if (msg.message?.includes("disabled in production")) {
              setStatus("prod_disabled");
            } else {
              setStatus("error");
            }
            setErrorMessage(msg.message || "Unknown error");
            break;
        }
      } catch (err) {
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setErrorMessage("WebSocket connection error");
    };

    ws.onclose = (event) => {
      wsRef.current = null;
      if (status !== "prod_disabled" && status !== "error") {
        setStatus("disconnected");
      }
      
      if (event.code !== 1000 && event.code !== 1008 && status !== "prod_disabled") {
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, 3000);
      }
    };
  }, [status]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close(1000);
      wsRef.current = null;
    }
    setStatus("disconnected");
    setSessionId(null);
    setPid(null);
  }, []);

  const reconnect = useCallback(() => {
    disconnect();
    setTimeout(() => connect(), 100);
  }, [connect, disconnect]);

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    const xterm = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
      theme: {
        background: "#0d1117",
        foreground: "#c9d1d9",
        cursor: "#c9d1d9",
        cursorAccent: "#0d1117",
        selectionBackground: "#264f78",
        black: "#0d1117",
        red: "#ff7b72",
        green: "#3fb950",
        yellow: "#d29922",
        blue: "#58a6ff",
        magenta: "#bc8cff",
        cyan: "#39c5cf",
        white: "#c9d1d9",
        brightBlack: "#484f58",
        brightRed: "#ffa198",
        brightGreen: "#56d364",
        brightYellow: "#e3b341",
        brightBlue: "#79c0ff",
        brightMagenta: "#d2a8ff",
        brightCyan: "#56d4dd",
        brightWhite: "#f0f6fc",
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    xterm.loadAddon(fitAddon);
    xterm.loadAddon(webLinksAddon);

    xterm.open(terminalRef.current);
    
    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    setTimeout(() => {
      try {
        fitAddon.fit();
      } catch (err) {
      }
    }, 100);

    xterm.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "input", data }));
      }
    });

    xterm.onResize(({ cols, rows }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    connect();

    return () => {
      disconnect();
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [connect, disconnect]);

  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current && xtermRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch (err) {
        }
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    window.addEventListener("resize", handleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const getStatusColor = () => {
    switch (status) {
      case "connected": return "bg-green-500/10 text-green-600 border-green-500/20";
      case "connecting": return "bg-yellow-500/10 text-yellow-600 border-yellow-500/20";
      case "error": return "bg-red-500/10 text-red-600 border-red-500/20";
      case "prod_disabled": return "bg-amber-500/10 text-amber-600 border-amber-500/20";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "connected": return `Connected (PID: ${pid})`;
      case "connecting": return "Connecting...";
      case "error": return "Error";
      case "prod_disabled": return "Disabled (PROD)";
      default: return "Disconnected";
    }
  };

  if (status === "prod_disabled") {
    return (
      <div className="flex-1 flex flex-col bg-background">
        <div className="h-8 border-b flex items-center justify-between px-3 bg-muted/30">
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">Shell</span>
          </div>
          <Badge variant="outline" className={getStatusColor()}>
            <Lock className="h-2.5 w-2.5 mr-1" />
            PROD
          </Badge>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Lock className="h-12 w-12 mx-auto mb-3 text-amber-600 opacity-50" />
            <p className="text-sm font-medium">Shell Disabled</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              Shell access is disabled in production mode for security.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background h-full">
      <div className="h-8 border-b flex items-center justify-between px-3 bg-muted/30 shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Shell</span>
          {sessionId && (
            <span className="text-[10px] text-muted-foreground font-mono">
              {sessionId}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn("text-[10px]", getStatusColor())}>
            {getStatusText()}
          </Badge>
          {status === "error" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={reconnect}
              data-testid="button-shell-reconnect"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          )}
          {status === "connected" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={disconnect}
              data-testid="button-shell-disconnect"
            >
              <XCircle className="h-3 w-3" />
            </Button>
          )}
          {status === "disconnected" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={connect}
              data-testid="button-shell-connect"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      
      {status === "error" && errorMessage && (
        <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/20 flex items-center gap-2 text-xs text-red-600">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span>{errorMessage}</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 text-xs"
            onClick={reconnect}
          >
            Retry
          </Button>
        </div>
      )}
      
      <div 
        ref={terminalRef} 
        className="flex-1 min-h-0"
        style={{ backgroundColor: "#0d1117" }}
        data-testid="shell-terminal"
      />
    </div>
  );
}
