import { Code, Eye, Database, KeyRound, Terminal, SquareTerminal, Wrench, Bot, Play } from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkspaceTab = "editor" | "preview" | "database" | "secrets" | "console" | "shell" | "developer" | "ai-agents" | "runs";

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
  { id: "runs", label: "Runs", icon: Play },
];

interface WorkspaceHeaderProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
}

export function WorkspaceHeader({ activeTab, onTabChange }: WorkspaceHeaderProps) {
  return (
    <div className="flex items-center h-6 px-0.5 gap-0 shrink-0">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "flex items-center gap-1 px-2 h-5 text-[10px] font-medium rounded-sm transition-colors",
              "hover-elevate",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            data-testid={`tab-workspace-${tab.id}`}
          >
            <Icon className="h-2.5 w-2.5" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
