import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Download, Trash2, Check, AlertCircle, Loader2, Server, HardDrive, RefreshCw } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface InstalledModel {
  name: string;
  sizeBytes?: number;
  modifiedAt?: string;
  digest?: string;
}

interface PullJob {
  id: string;
  model: string;
  status: "queued" | "pulling" | "verifying" | "done" | "error" | "canceled";
  progress: number;
  downloadedBytes?: number;
  totalBytes?: number;
  message?: string;
  error?: string;
}

interface OllamaModelsResponse {
  installed: InstalledModel[];
  jobs: PullJob[];
}

interface OllamaVersionResponse {
  reachable: boolean;
  version?: string;
  baseUrl?: string;
  error?: string;
}

const RECOMMENDED_MODELS = [
  { name: "qwen2.5:7b", label: "Fast Coding", desc: "Recommended default", size: "4.7 GB" },
  { name: "qwen2.5-coder:7b", label: "Code Specialist", desc: "Optimized for code", size: "4.7 GB" },
  { name: "llama3.1:8b", label: "General Assistant", desc: "Versatile reasoning", size: "4.9 GB" },
  { name: "deepseek-coder:6.7b", label: "Deep Coder", desc: "Code generation", size: "3.8 GB" },
];

function formatBytes(bytes?: number): string {
  if (!bytes) return "Unknown";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

function formatTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay > 1 ? "s" : ""} ago`;
}

export function OllamaModelManager() {
  const { toast } = useToast();
  const [modelInput, setModelInput] = useState("");

  const { data: versionData, isLoading: versionLoading } = useQuery<OllamaVersionResponse>({
    queryKey: ["/api/ollama/version"],
    refetchInterval: 30000,
  });

  const { data: modelsData, isLoading: modelsLoading, refetch: refetchModels } = useQuery<OllamaModelsResponse>({
    queryKey: ["/api/ollama/models"],
    refetchInterval: 2000,
    enabled: versionData?.reachable,
  });

  const pullMutation = useMutation({
    mutationFn: async (model: string) => {
      return apiRequest("POST", "/api/ollama/pull", { model });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ollama/models"] });
      setModelInput("");
    },
    onError: (error: Error) => {
      toast({ title: "Pull failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (name: string) => {
      return apiRequest("DELETE", `/api/ollama/model/${encodeURIComponent(name)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ollama/models"] });
      toast({ title: "Model removed", description: "Model has been deleted from Ollama." });
    },
    onError: (error: Error) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  const handleInstall = () => {
    const models = modelInput.split(",").map(s => s.trim()).filter(Boolean);
    for (const m of models) {
      pullMutation.mutate(m);
    }
  };

  const handleInstallRecommended = (name: string) => {
    pullMutation.mutate(name);
  };

  const isInstalled = (name: string) => {
    return modelsData?.installed.some(m => m.name === name || m.name.startsWith(name.split(":")[0]));
  };

  const activeJobs = modelsData?.jobs.filter(j => j.status === "pulling" || j.status === "verifying" || j.status === "queued") ?? [];

  if (!versionData?.reachable && !versionLoading) {
    return (
      <div className="space-y-4">
        <Card className="border-destructive/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="w-5 h-5" />
              Ollama Not Reachable
            </CardTitle>
            <CardDescription>
              Could not connect to Ollama at the configured endpoint.
              {versionData?.error && <span className="block mt-1 text-xs font-mono">{versionData.error}</span>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Make sure Ollama is running and accessible. If using Docker, ensure the ollama service is healthy.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[500px] pr-4">
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="w-4 h-4" />
              Ollama Runtime
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            <Badge variant="outline" className="gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              Connected
            </Badge>
            {versionData?.version && (
              <span className="text-sm text-muted-foreground">v{versionData.version}</span>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["/api/ollama/version"] });
                refetchModels();
              }}
              data-testid="button-refresh-ollama"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recommended Models</CardTitle>
            <CardDescription>One-click install for common use cases</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {RECOMMENDED_MODELS.map(m => {
                const installed = isInstalled(m.name);
                return (
                  <div key={m.name} className="flex items-center justify-between p-2 rounded-md border bg-muted/30">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{m.label}</span>
                        {installed && <Badge variant="secondary" className="text-xs">Installed</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {m.name} &middot; {m.size}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={installed ? "ghost" : "default"}
                      onClick={() => handleInstallRecommended(m.name)}
                      disabled={pullMutation.isPending}
                      data-testid={`button-install-${m.name.replace(/[:.]/g, "-")}`}
                    >
                      {installed ? <Check className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Install Custom Model</CardTitle>
            <CardDescription>Enter model names (comma-separated for multiple)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="e.g. qwen2.5:7b, mistral:7b"
                value={modelInput}
                onChange={e => setModelInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleInstall()}
                data-testid="input-model-name"
              />
              <Button
                onClick={handleInstall}
                disabled={!modelInput.trim() || pullMutation.isPending}
                data-testid="button-install-model"
              >
                <Download className="w-4 h-4 mr-1" />
                Install
              </Button>
            </div>
          </CardContent>
        </Card>

        {activeJobs.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Downloads
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {activeJobs.map(job => (
                <div key={job.id} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{job.model}</span>
                    <span className="text-muted-foreground">
                      {job.status === "verifying" ? "Verifying..." : `${Math.round(job.progress * 100)}%`}
                    </span>
                  </div>
                  <Progress value={job.progress * 100} className="h-2" />
                  {job.message && (
                    <p className="text-xs text-muted-foreground truncate">{job.message}</p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <HardDrive className="w-4 h-4" />
              Installed Models
            </CardTitle>
            <CardDescription>
              {modelsData?.installed.length ?? 0} model{(modelsData?.installed.length ?? 0) !== 1 ? "s" : ""} installed
            </CardDescription>
          </CardHeader>
          <CardContent>
            {modelsLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading...
              </div>
            ) : modelsData?.installed.length === 0 ? (
              <p className="text-sm text-muted-foreground">No models installed yet. Install one above to get started.</p>
            ) : (
              <div className="space-y-2">
                {modelsData?.installed.map(m => (
                  <div key={m.name} className="flex items-center justify-between p-2 rounded-md border bg-muted/30">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{m.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatBytes(m.sizeBytes)}
                        {m.modifiedAt && ` · ${formatTime(m.modifiedAt)}`}
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(m.name)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-${m.name.replace(/[:.]/g, "-")}`}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}
