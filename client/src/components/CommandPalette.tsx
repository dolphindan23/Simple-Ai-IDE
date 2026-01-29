import { useState, useEffect, useMemo } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { File, Folder, Settings, Terminal, Play, FileCode, TestTube, MessageSquare, Layout, Bot, Lock, Database, Code } from "lucide-react";
import type { FileNode } from "@shared/schema";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: FileNode[];
  onSelectFile: (path: string) => void;
  onToggleTerminal: () => void;
  onSwitchTab: (tab: string) => void;
  onRunAction: (action: "plan" | "implement" | "test" | "review") => void;
  onOpenSettings: () => void;
}

function flattenFiles(nodes: FileNode[], result: FileNode[] = []): FileNode[] {
  for (const node of nodes) {
    result.push(node);
    if (node.children) {
      flattenFiles(node.children, result);
    }
  }
  return result;
}

export function CommandPalette({
  open,
  onOpenChange,
  files,
  onSelectFile,
  onToggleTerminal,
  onSwitchTab,
  onRunAction,
  onOpenSettings,
}: CommandPaletteProps) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) {
      setSearch("");
    }
  }, [open]);

  const flatFiles = useMemo(() => flattenFiles(files), [files]);

  const filteredFiles = useMemo(() => {
    if (!search) return flatFiles.slice(0, 10);
    const lower = search.toLowerCase();
    return flatFiles
      .filter((f) => f.name.toLowerCase().includes(lower) || f.path.toLowerCase().includes(lower))
      .slice(0, 15);
  }, [flatFiles, search]);

  const handleSelect = (action: string) => {
    onOpenChange(false);
    
    if (action.startsWith("file:")) {
      onSelectFile(action.replace("file:", ""));
    } else if (action.startsWith("tab:")) {
      onSwitchTab(action.replace("tab:", ""));
    } else if (action.startsWith("ai:")) {
      const aiAction = action.replace("ai:", "") as "plan" | "implement" | "test" | "review";
      onRunAction(aiAction);
    } else if (action === "toggle-terminal") {
      onToggleTerminal();
    } else if (action === "settings") {
      onOpenSettings();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 max-w-lg">
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <DialogDescription className="sr-only">Search for files, actions, and commands</DialogDescription>
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
          <CommandInput 
            placeholder="Type a command or search..." 
            value={search}
            onValueChange={setSearch}
            data-testid="command-palette-input"
          />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            
            {filteredFiles.length > 0 && (
              <CommandGroup heading="Files">
                {filteredFiles.map((file) => (
                  <CommandItem
                    key={file.path}
                    value={`file:${file.path}`}
                    onSelect={handleSelect}
                    data-testid={`cmd-file-${file.path}`}
                  >
                    {file.type === "directory" ? (
                      <Folder className="mr-2 h-4 w-4 text-amber-400" />
                    ) : (
                      <File className="mr-2 h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="flex-1 truncate">{file.name}</span>
                    <span className="text-xs text-muted-foreground truncate max-w-32">{file.path}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            <CommandSeparator />

            <CommandGroup heading="AI Actions">
              <CommandItem value="ai:plan" onSelect={handleSelect} data-testid="cmd-ai-plan">
                <FileCode className="mr-2 h-4 w-4 text-blue-400" />
                <span>Run Plan</span>
              </CommandItem>
              <CommandItem value="ai:implement" onSelect={handleSelect} data-testid="cmd-ai-implement">
                <Play className="mr-2 h-4 w-4 text-green-400" />
                <span>Run Implement</span>
              </CommandItem>
              <CommandItem value="ai:test" onSelect={handleSelect} data-testid="cmd-ai-test">
                <TestTube className="mr-2 h-4 w-4 text-yellow-400" />
                <span>Run Test</span>
              </CommandItem>
              <CommandItem value="ai:review" onSelect={handleSelect} data-testid="cmd-ai-review">
                <MessageSquare className="mr-2 h-4 w-4 text-purple-400" />
                <span>Run Review</span>
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Workspace">
              <CommandItem value="tab:editor" onSelect={handleSelect} data-testid="cmd-tab-editor">
                <Code className="mr-2 h-4 w-4" />
                <span>Switch to Editor</span>
              </CommandItem>
              <CommandItem value="tab:preview" onSelect={handleSelect} data-testid="cmd-tab-preview">
                <Layout className="mr-2 h-4 w-4" />
                <span>Switch to Preview</span>
              </CommandItem>
              <CommandItem value="tab:database" onSelect={handleSelect} data-testid="cmd-tab-database">
                <Database className="mr-2 h-4 w-4" />
                <span>Switch to Database</span>
              </CommandItem>
              <CommandItem value="tab:secrets" onSelect={handleSelect} data-testid="cmd-tab-secrets">
                <Lock className="mr-2 h-4 w-4" />
                <span>Switch to Secrets</span>
              </CommandItem>
              <CommandItem value="tab:developer" onSelect={handleSelect} data-testid="cmd-tab-developer">
                <Bot className="mr-2 h-4 w-4" />
                <span>Switch to Developer</span>
              </CommandItem>
              <CommandItem value="tab:ai-agents" onSelect={handleSelect} data-testid="cmd-tab-ai-agents">
                <Bot className="mr-2 h-4 w-4" />
                <span>Switch to AI Agents</span>
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Actions">
              <CommandItem value="toggle-terminal" onSelect={handleSelect} data-testid="cmd-toggle-terminal">
                <Terminal className="mr-2 h-4 w-4" />
                <span>Toggle Output Panel</span>
                <span className="ml-auto text-xs text-muted-foreground">Ctrl+J</span>
              </CommandItem>
              <CommandItem value="settings" onSelect={handleSelect} data-testid="cmd-settings">
                <Settings className="mr-2 h-4 w-4" />
                <span>Open Settings</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
