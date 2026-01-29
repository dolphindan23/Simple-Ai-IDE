import { useEffect, useRef } from "react";
import { Terminal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface TerminalPanelProps {
  logs: string[];
  onClear: () => void;
}

export function TerminalPanel({ logs, onClear }: TerminalPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const formatLog = (log: string, index: number) => {
    // Parse log levels and style accordingly
    let className = "text-foreground/80";
    let prefix = "";

    if (log.includes("[ERROR]") || log.includes("error") || log.includes("Error")) {
      className = "text-red-400";
      prefix = "";
    } else if (log.includes("[WARN]") || log.includes("warning") || log.includes("Warning")) {
      className = "text-yellow-400";
      prefix = "";
    } else if (log.includes("[INFO]") || log.includes("Starting") || log.includes("Complete")) {
      className = "text-blue-400";
      prefix = "";
    } else if (log.includes("[SUCCESS]") || log.includes("success") || log.includes("Success")) {
      className = "text-green-400";
      prefix = "";
    }

    return (
      <div
        key={index}
        className={`font-mono text-xs leading-relaxed ${className}`}
      >
        {prefix}{log}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-card border-t border-border">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Output
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClear}
          className="h-6 w-6"
          data-testid="button-clear-terminal"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      
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
    </div>
  );
}
