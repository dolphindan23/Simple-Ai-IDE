import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";

interface KeyboardShortcutsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string; description: string }[];
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: "General",
    shortcuts: [
      { keys: "Ctrl+K", description: "Open Command Palette" },
      { keys: "Ctrl+S", description: "Save File" },
      { keys: "Ctrl+,", description: "Open Settings" },
      { keys: "Ctrl+Shift+P", description: "Open Project Settings" },
    ],
  },
  {
    title: "Editor",
    shortcuts: [
      { keys: "Ctrl+Z", description: "Undo" },
      { keys: "Ctrl+Shift+Z", description: "Redo" },
      { keys: "Ctrl+F", description: "Find in File" },
      { keys: "Ctrl+H", description: "Find and Replace" },
      { keys: "Ctrl+G", description: "Go to Line" },
      { keys: "Ctrl+D", description: "Select Next Occurrence" },
    ],
  },
  {
    title: "Panels",
    shortcuts: [
      { keys: "Ctrl+J", description: "Toggle Terminal" },
      { keys: "Ctrl+`", description: "Focus Terminal" },
      { keys: "Ctrl+B", description: "Toggle Sidebar" },
      { keys: "Ctrl+Shift+E", description: "Focus Explorer" },
    ],
  },
  {
    title: "AI Actions",
    shortcuts: [
      { keys: "Ctrl+Shift+P", description: "Plan" },
      { keys: "Ctrl+Shift+I", description: "Implement" },
      { keys: "Ctrl+Shift+T", description: "Test" },
      { keys: "Ctrl+Shift+R", description: "Review" },
    ],
  },
];

export function KeyboardShortcutsModal({ open, onOpenChange }: KeyboardShortcutsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto" data-testid="dialog-keyboard-shortcuts">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="w-5 h-5" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Quick reference for keyboard shortcuts
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {shortcutGroups.map((group) => (
            <div key={group.title}>
              <h3 className="text-sm font-medium mb-2 text-muted-foreground">
                {group.title}
              </h3>
              <div className="space-y-1">
                {group.shortcuts.map((shortcut, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/50"
                    data-testid={`shortcut-${shortcut.keys.replace(/\+/g, "-").toLowerCase()}`}
                  >
                    <span className="text-sm">{shortcut.description}</span>
                    <kbd className="px-2 py-0.5 text-xs font-mono bg-background border rounded">
                      {shortcut.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
