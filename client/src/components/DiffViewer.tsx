import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface DiffViewerProps {
  diff: string;
  className?: string;
}

interface DiffLine {
  type: "header" | "context" | "addition" | "deletion" | "hunk";
  content: string;
  lineNumber?: { old?: number; new?: number };
}

export function DiffViewer({ diff, className }: DiffViewerProps) {
  const parsedDiff = useMemo(() => {
    const lines = diff.split("\n");
    const parsed: DiffLine[] = [];
    let oldLine = 0;
    let newLine = 0;

    for (const line of lines) {
      if (line.startsWith("---") || line.startsWith("+++")) {
        parsed.push({ type: "header", content: line });
      } else if (line.startsWith("@@")) {
        // Parse hunk header like @@ -1,3 +1,4 @@
        const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
        if (match) {
          oldLine = parseInt(match[1]) - 1;
          newLine = parseInt(match[2]) - 1;
        }
        parsed.push({ type: "hunk", content: line });
      } else if (line.startsWith("+")) {
        newLine++;
        parsed.push({
          type: "addition",
          content: line.slice(1),
          lineNumber: { new: newLine },
        });
      } else if (line.startsWith("-")) {
        oldLine++;
        parsed.push({
          type: "deletion",
          content: line.slice(1),
          lineNumber: { old: oldLine },
        });
      } else if (line.startsWith(" ")) {
        oldLine++;
        newLine++;
        parsed.push({
          type: "context",
          content: line.slice(1),
          lineNumber: { old: oldLine, new: newLine },
        });
      } else if (line.trim()) {
        parsed.push({ type: "context", content: line });
      }
    }

    return parsed;
  }, [diff]);

  const getLineStyle = (type: DiffLine["type"]) => {
    switch (type) {
      case "addition":
        return "bg-green-500/10 text-green-400";
      case "deletion":
        return "bg-red-500/10 text-red-400";
      case "header":
        return "bg-muted/50 text-muted-foreground font-semibold";
      case "hunk":
        return "bg-blue-500/10 text-blue-400";
      default:
        return "text-foreground/70";
    }
  };

  const getPrefix = (type: DiffLine["type"]) => {
    switch (type) {
      case "addition":
        return "+";
      case "deletion":
        return "-";
      default:
        return " ";
    }
  };

  if (!diff.trim()) {
    return (
      <div className={cn("flex items-center justify-center h-full text-muted-foreground text-sm", className)}>
        No diff to display
      </div>
    );
  }

  return (
    <div className={cn("font-mono text-xs overflow-auto", className)}>
      <table className="w-full border-collapse">
        <tbody>
          {parsedDiff.map((line, index) => (
            <tr key={index} className={cn(getLineStyle(line.type))}>
              {line.type !== "header" && line.type !== "hunk" && (
                <>
                  <td className="w-10 text-right pr-2 select-none text-muted-foreground/50 border-r border-border">
                    {line.lineNumber?.old || ""}
                  </td>
                  <td className="w-10 text-right pr-2 select-none text-muted-foreground/50 border-r border-border">
                    {line.lineNumber?.new || ""}
                  </td>
                </>
              )}
              <td
                className={cn(
                  "px-2 py-0.5 whitespace-pre",
                  (line.type === "header" || line.type === "hunk") && "px-3 py-1"
                )}
                colSpan={line.type === "header" || line.type === "hunk" ? 3 : 1}
              >
                {line.type !== "header" && line.type !== "hunk" && (
                  <span className="inline-block w-4 select-none opacity-50">
                    {getPrefix(line.type)}
                  </span>
                )}
                {line.content}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
