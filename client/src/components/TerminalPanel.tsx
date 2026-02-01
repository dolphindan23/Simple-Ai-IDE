import { useEffect, useRef, useCallback } from "react";
import { Terminal, Trash2, ChevronDown, ChevronUp, X, GripHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export type TerminalState = "expanded" | "collapsed" | "hidden";

interface TerminalPanelProps {
  logs: string[];
  onClear: () => void;
  terminalState: TerminalState;
  onTerminalStateChange: (state: TerminalState) => void;
  terminalHeight: number;
  onTerminalHeightChange: (height: number) => void;
  onFocusTerminal?: () => void;
}

export function TerminalPanel({
  logs,
  onClear,
  terminalState,
  onTerminalStateChange,
  terminalHeight,
  onTerminalHeightChange,
}: TerminalPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = terminalHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const newHeight = Math.max(100, Math.min(600, startHeight + delta));
      onTerminalHeightChange(newHeight);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [terminalHeight, onTerminalHeightChange]);

  const formatLog = (log: string, index: number) => {
    let className = "text-foreground/80";

    if (log.includes("[ERROR]") || log.includes("error") || log.includes("Error")) {
      className = "text-red-400";
    } else if (log.includes("[WARN]") || log.includes("warning") || log.includes("Warning")) {
      className = "text-yellow-400";
    } else if (log.includes("[INFO]") || log.includes("Starting") || log.includes("Complete")) {
      className = "text-blue-400";
    } else if (log.includes("[SUCCESS]") || log.includes("success") || log.includes("Success")) {
      className = "text-green-400";
    }

    return (
      <div
        key={index}
        className={`font-mono text-xs leading-relaxed ${className}`}
      >
        {log}
      </div>
    );
  };

  if (terminalState === "hidden") {
    return null;
  }

  const isCollapsed = terminalState === "collapsed";
  const headerHeight = 36;

  return (
    <div
      ref={containerRef}
      className="flex flex-col bg-card border-t border-border"
      style={{ height: isCollapsed ? headerHeight : terminalHeight }}
      data-testid="terminal-panel"
    >
      <div
        ref={resizeRef}
        className={cn(
          "h-1 cursor-ns-resize flex items-center justify-center group",
          "hover:bg-primary/20 transition-colors",
          isCollapsed && "hidden"
        )}
        onMouseDown={handleMouseDown}
        data-testid="terminal-resize-handle"
      >
        <GripHorizontal className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Output
          </span>
          {logs.length > 0 && (
            <span className="text-xs text-muted-foreground/60">
              ({logs.length} lines)
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onClear}
            className="h-6 w-6"
            title="Clear output"
            data-testid="button-clear-terminal"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onTerminalStateChange(isCollapsed ? "expanded" : "collapsed")}
            className="h-6 w-6"
            title={isCollapsed ? "Expand terminal" : "Collapse terminal"}
            data-testid="button-toggle-terminal"
          >
            {isCollapsed ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onTerminalStateChange("hidden")}
            className="h-6 w-6"
            title="Close terminal"
            data-testid="button-close-terminal"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      
      {!isCollapsed && (
        <ScrollArea className="flex-1 p-3" ref={scrollRef}>
          {logs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
              <span className="opacity-50">No output yet. Run a task to see logs here.</span>
            </div>
          ) : (
            <div className="space-y-0.5">
              {logs.map((log, index) => formatLog(log, index))}
              <div ref={bottomRef} />
            </div>
          )}
        </ScrollArea>
      )}
    </div>
  );
}
