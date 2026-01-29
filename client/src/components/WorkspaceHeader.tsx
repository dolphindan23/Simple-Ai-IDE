import { Code, Eye, Database, KeyRound, Terminal, SquareTerminal, Wrench, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkspaceTab = "editor" | "preview" | "database" | "secrets" | "console" | "shell" | "developer" | "ai-agents";

interface TabConfig {
  id: WorkspaceTab;
  label: string;
  icon: typeof Code;
}

const tabs: TabConfig[] = [
  { id: "editor", label: "Editor", icon: Code },
  { id: "preview", label: "Preview", icon: Eye },
  { id: "database", label: "Database", icon: Database },
  { id: "secrets", label: "Secrets", icon: KeyRound },
  { id: "console", label: "Console", icon: Terminal },
  { id: "shell", label: "Shell", icon: SquareTerminal },
  { id: "developer", label: "Developer", icon: Wrench },
  { id: "ai-agents", label: "AI Agents", icon: Bot },
];

interface WorkspaceHeaderProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  fileName?: string | null;
}

export function WorkspaceHeader({ activeTab, onTabChange, fileName }: WorkspaceHeaderProps) {
  return (
    <div className="flex items-center h-9 bg-muted/30 border-b border-border px-1 gap-0.5 shrink-0">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 h-7 text-xs font-medium rounded-sm transition-colors",
              "hover-elevate",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            data-testid={`tab-workspace-${tab.id}`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{tab.label}</span>
          </button>
        );
      })}
      
      {fileName && activeTab === "editor" && (
        <div className="ml-auto flex items-center gap-2 px-2">
          <span className="text-xs text-muted-foreground truncate max-w-[200px]">
            {fileName}
          </span>
        </div>
      )}
    </div>
  );
}
