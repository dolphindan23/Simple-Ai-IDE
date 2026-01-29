import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Settings, Sun, Moon, Monitor, Code2, Bot, Puzzle, Shield } from "lucide-react";
import type { Settings as SettingsType } from "@shared/schema";

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<SettingsType | null>(null);

  const { data: savedSettings, isLoading } = useQuery<SettingsType>({
    queryKey: ["/api/settings"],
    enabled: open,
  });

  useEffect(() => {
    if (savedSettings) {
      setSettings(savedSettings);
    }
  }, [savedSettings]);

  const saveMutation = useMutation({
    mutationFn: async (newSettings: SettingsType) => {
      return apiRequest("PUT", "/api/settings", newSettings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings saved", description: "Your preferences have been updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    if (settings) {
      saveMutation.mutate(settings);
    }
  };

  if (!settings) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" data-testid="dialog-settings">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Settings
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="general" className="mt-4">
          <TabsList className="grid w-full grid-cols-4" data-testid="settings-tabs">
            <TabsTrigger value="general" className="flex items-center gap-1" data-testid="tab-general">
              <Monitor className="w-4 h-4" />
              <span className="hidden sm:inline">General</span>
            </TabsTrigger>
            <TabsTrigger value="editor" className="flex items-center gap-1" data-testid="tab-editor">
              <Code2 className="w-4 h-4" />
              <span className="hidden sm:inline">Editor</span>
            </TabsTrigger>
            <TabsTrigger value="ai" className="flex items-center gap-1" data-testid="tab-ai">
              <Bot className="w-4 h-4" />
              <span className="hidden sm:inline">AI</span>
            </TabsTrigger>
            <TabsTrigger value="integrations" className="flex items-center gap-1" data-testid="tab-integrations">
              <Puzzle className="w-4 h-4" />
              <span className="hidden sm:inline">APIs</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4 mt-4" data-testid="panel-general">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Theme</Label>
                  <p className="text-sm text-muted-foreground">Choose your preferred color theme</p>
                </div>
                <Select
                  value={settings.general.theme}
                  onValueChange={(value) => setSettings({
                    ...settings,
                    general: { ...settings.general, theme: value as "light" | "dark" | "system" }
                  })}
                >
                  <SelectTrigger className="w-[140px]" data-testid="select-theme">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light"><div className="flex items-center gap-2"><Sun className="w-4 h-4" /> Light</div></SelectItem>
                    <SelectItem value="dark"><div className="flex items-center gap-2"><Moon className="w-4 h-4" /> Dark</div></SelectItem>
                    <SelectItem value="system"><div className="flex items-center gap-2"><Monitor className="w-4 h-4" /> System</div></SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Show Hidden Files</Label>
                  <p className="text-sm text-muted-foreground">Display files starting with a dot</p>
                </div>
                <Switch
                  checked={settings.general.showHiddenFiles}
                  onCheckedChange={(checked) => setSettings({
                    ...settings,
                    general: { ...settings.general, showHiddenFiles: checked }
                  })}
                  data-testid="switch-hidden-files"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Auto-Save Delay</Label>
                    <p className="text-sm text-muted-foreground">Time in ms before auto-saving</p>
                  </div>
                  <span className="text-sm font-mono">{settings.general.autoSaveDelay}ms</span>
                </div>
                <Slider
                  value={[settings.general.autoSaveDelay]}
                  onValueChange={([value]) => setSettings({
                    ...settings,
                    general: { ...settings.general, autoSaveDelay: value }
                  })}
                  min={500}
                  max={10000}
                  step={500}
                  data-testid="slider-autosave-delay"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="editor" className="space-y-4 mt-4" data-testid="panel-editor">
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Font Size</Label>
                    <p className="text-sm text-muted-foreground">Editor font size in pixels</p>
                  </div>
                  <span className="text-sm font-mono">{settings.editor.fontSize}px</span>
                </div>
                <Slider
                  value={[settings.editor.fontSize]}
                  onValueChange={([value]) => setSettings({
                    ...settings,
                    editor: { ...settings.editor, fontSize: value }
                  })}
                  min={8}
                  max={32}
                  step={1}
                  data-testid="slider-font-size"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Tab Size</Label>
                    <p className="text-sm text-muted-foreground">Number of spaces per tab</p>
                  </div>
                  <span className="text-sm font-mono">{settings.editor.tabSize}</span>
                </div>
                <Slider
                  value={[settings.editor.tabSize]}
                  onValueChange={([value]) => setSettings({
                    ...settings,
                    editor: { ...settings.editor, tabSize: value }
                  })}
                  min={1}
                  max={8}
                  step={1}
                  data-testid="slider-tab-size"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Word Wrap</Label>
                  <p className="text-sm text-muted-foreground">How to wrap long lines</p>
                </div>
                <Select
                  value={settings.editor.wordWrap}
                  onValueChange={(value) => setSettings({
                    ...settings,
                    editor: { ...settings.editor, wordWrap: value as any }
                  })}
                >
                  <SelectTrigger className="w-[140px]" data-testid="select-word-wrap">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on">On</SelectItem>
                    <SelectItem value="off">Off</SelectItem>
                    <SelectItem value="bounded">Bounded</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Line Numbers</Label>
                  <p className="text-sm text-muted-foreground">How to display line numbers</p>
                </div>
                <Select
                  value={settings.editor.lineNumbers}
                  onValueChange={(value) => setSettings({
                    ...settings,
                    editor: { ...settings.editor, lineNumbers: value as any }
                  })}
                >
                  <SelectTrigger className="w-[140px]" data-testid="select-line-numbers">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on">On</SelectItem>
                    <SelectItem value="off">Off</SelectItem>
                    <SelectItem value="relative">Relative</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Minimap</Label>
                  <p className="text-sm text-muted-foreground">Show code minimap on the right</p>
                </div>
                <Switch
                  checked={settings.editor.minimap}
                  onCheckedChange={(checked) => setSettings({
                    ...settings,
                    editor: { ...settings.editor, minimap: checked }
                  })}
                  data-testid="switch-minimap"
                />
              </div>

              <div className="space-y-2">
                <Label>Font Family</Label>
                <Input
                  value={settings.editor.fontFamily}
                  onChange={(e) => setSettings({
                    ...settings,
                    editor: { ...settings.editor, fontFamily: e.target.value }
                  })}
                  placeholder="JetBrains Mono, monospace"
                  data-testid="input-font-family"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="ai" className="space-y-4 mt-4" data-testid="panel-ai">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Ollama URL</Label>
                <p className="text-sm text-muted-foreground">URL of your Ollama server</p>
                <Input
                  value={settings.ai.ollamaUrl}
                  onChange={(e) => setSettings({
                    ...settings,
                    ai: { ...settings.ai, ollamaUrl: e.target.value }
                  })}
                  placeholder="http://localhost:11434"
                  data-testid="input-ollama-url"
                />
              </div>

              <div className="space-y-2">
                <Label>Ollama Model</Label>
                <p className="text-sm text-muted-foreground">Which LLM model to use</p>
                <Input
                  value={settings.ai.ollamaModel}
                  onChange={(e) => setSettings({
                    ...settings,
                    ai: { ...settings.ai, ollamaModel: e.target.value }
                  })}
                  placeholder="codellama"
                  data-testid="input-ollama-model"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Auto-Save Before AI Tasks</Label>
                  <p className="text-sm text-muted-foreground">Save files before running AI workflows</p>
                </div>
                <Switch
                  checked={settings.ai.autoSave}
                  onCheckedChange={(checked) => setSettings({
                    ...settings,
                    ai: { ...settings.ai, autoSave: checked }
                  })}
                  data-testid="switch-ai-autosave"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="integrations" className="space-y-4 mt-4" data-testid="panel-integrations">
            <div className="space-y-6">
              <div className="p-4 border rounded-md space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base font-medium">Kaggle</Label>
                    <p className="text-sm text-muted-foreground">Access Kaggle datasets and competitions</p>
                  </div>
                  <Switch
                    checked={settings.integrations.kaggle.enabled}
                    onCheckedChange={(checked) => setSettings({
                      ...settings,
                      integrations: {
                        ...settings.integrations,
                        kaggle: { ...settings.integrations.kaggle, enabled: checked }
                      }
                    })}
                    data-testid="switch-kaggle"
                  />
                </div>
                {settings.integrations.kaggle.enabled && (
                  <div className="space-y-2 pt-2">
                    <Label>Kaggle Username</Label>
                    <Input
                      value={settings.integrations.kaggle.username || ""}
                      onChange={(e) => setSettings({
                        ...settings,
                        integrations: {
                          ...settings.integrations,
                          kaggle: { ...settings.integrations.kaggle, username: e.target.value }
                        }
                      })}
                      placeholder="your-kaggle-username"
                      data-testid="input-kaggle-username"
                    />
                    <p className="text-xs text-muted-foreground">API key is stored in the encrypted secrets vault</p>
                  </div>
                )}
              </div>

              <div className="p-4 border rounded-md space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base font-medium">HuggingFace</Label>
                    <p className="text-sm text-muted-foreground">Access HuggingFace models and datasets</p>
                  </div>
                  <Switch
                    checked={settings.integrations.huggingface.enabled}
                    onCheckedChange={(checked) => setSettings({
                      ...settings,
                      integrations: {
                        ...settings.integrations,
                        huggingface: { ...settings.integrations.huggingface, enabled: checked }
                      }
                    })}
                    data-testid="switch-huggingface"
                  />
                </div>
                {settings.integrations.huggingface.enabled && (
                  <p className="text-xs text-muted-foreground pt-2">API token is stored in the encrypted secrets vault</p>
                )}
              </div>

              <div className="p-4 border rounded-md space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base font-medium">NVIDIA NGC</Label>
                    <p className="text-sm text-muted-foreground">Access NVIDIA GPU Cloud resources</p>
                  </div>
                  <Switch
                    checked={settings.integrations.ngc.enabled}
                    onCheckedChange={(checked) => setSettings({
                      ...settings,
                      integrations: {
                        ...settings.integrations,
                        ngc: { ...settings.integrations.ngc, enabled: checked }
                      }
                    })}
                    data-testid="switch-ngc"
                  />
                </div>
                {settings.integrations.ngc.enabled && (
                  <div className="space-y-2 pt-2">
                    <Label>NGC Organization</Label>
                    <Input
                      value={settings.integrations.ngc.org || ""}
                      onChange={(e) => setSettings({
                        ...settings,
                        integrations: {
                          ...settings.integrations,
                          ngc: { ...settings.integrations.ngc, org: e.target.value }
                        }
                      })}
                      placeholder="your-ngc-org"
                      data-testid="input-ngc-org"
                    />
                    <p className="text-xs text-muted-foreground">API key is stored in the encrypted secrets vault</p>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-settings">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-settings">
            {saveMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
