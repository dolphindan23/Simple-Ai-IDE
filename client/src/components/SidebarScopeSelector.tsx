import { ChevronDown, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SidebarScope } from "@/hooks/useAIRunEvents";

interface SidebarScopeSelectorProps {
  scope: SidebarScope;
  onScopeChange: (scope: SidebarScope) => void;
  currentWorkspaceName?: string;
}

export function SidebarScopeSelector({ 
  scope, 
  onScopeChange,
  currentWorkspaceName = "Current"
}: SidebarScopeSelectorProps) {
  const label = scope === "all" ? "All Workspaces" : `${currentWorkspaceName} Workspace`;
  
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-6 px-2 text-xs gap-1"
          data-testid="button-sidebar-scope"
        >
          <Layers className="h-3 w-3" />
          <span className="truncate max-w-[100px]">{label}</span>
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem 
          onClick={() => onScopeChange("current")}
          data-testid="menuitem-scope-current"
        >
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${scope === "current" ? "bg-primary" : "bg-transparent"}`} />
            <span>{currentWorkspaceName} Workspace</span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem 
          onClick={() => onScopeChange("all")}
          data-testid="menuitem-scope-all"
        >
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${scope === "all" ? "bg-primary" : "bg-transparent"}`} />
            <span>All Workspaces</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
