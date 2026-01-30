import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, GitBranch, Check, X, AlertCircle, ExternalLink, RefreshCw, FolderGit2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface ImportRepoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: (projectId: string) => void;
}

interface ValidationResult {
  valid: boolean;
  sanitizedUrl?: string;
  provider?: string;
  owner?: string;
  repo?: string;
  error?: string;
}

interface ImportResult {
  ok: boolean;
  data?: {
    projectId: string;
    status: string;
    message: string;
  };
  error?: string;
}

interface GitOp {
  id: string;
  project_id: string;
  op: string;
  status: string;
  created_at: string;
  started_at?: string;
  ended_at?: string;
  error?: string;
  logTail?: string;
}

type Step = "url" | "auth" | "options" | "progress";

export function ImportRepoModal({ open, onOpenChange, onImported }: ImportRepoModalProps) {
  const [step, setStep] = useState<Step>("url");
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [projectName, setProjectName] = useState("");
  const [authType, setAuthType] = useState<"none" | "pat">("none");
  const [secretKey, setSecretKey] = useState("");
  const [autoStartRun, setAutoStartRun] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [importedProjectId, setImportedProjectId] = useState<string | null>(null);
  const [gitOpId, setGitOpId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setStep("url");
      setUrl("");
      setBranch("");
      setProjectName("");
      setAuthType("none");
      setSecretKey("");
      setAutoStartRun(false);
      setValidation(null);
      setImportedProjectId(null);
      setGitOpId(null);
    }
  }, [open]);

  const validateMutation = useMutation({
    mutationFn: async (gitUrl: string) => {
      const response = await apiRequest("POST", "/api/v1/projects/test-project-1-ml0io8yy/git/validate-url", { url: gitUrl });
      return response.json() as Promise<ValidationResult>;
    },
    onSuccess: (data) => {
      setValidation(data);
      if (data.valid && data.repo && !projectName) {
        setProjectName(data.repo);
      }
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/v1/projects/import/git", {
        name: projectName,
        git: { url: validation?.sanitizedUrl || url, branch: branch || undefined },
        auth: authType === "pat" ? { type: "pat", secretKey } : { type: "none" },
        options: { depth: 1, recurseSubmodules: true },
        bootstrap: { autoStartRun },
      });
      return response.json() as Promise<ImportResult>;
    },
    onSuccess: (data) => {
      if (data.ok && data.data) {
        setImportedProjectId(data.data.projectId);
        setStep("progress");
      }
    },
  });

  const { data: gitOpStatus, refetch: refetchGitOp } = useQuery<GitOp>({
    queryKey: ["/api/v1/projects", importedProjectId, "git/ops", gitOpId],
    enabled: !!importedProjectId && step === "progress",
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === "succeeded" || data?.status === "failed") {
        return false;
      }
      return 1000;
    },
  });

  const { data: gitOps } = useQuery<{ ops: GitOp[] }>({
    queryKey: ["/api/v1/projects", importedProjectId, "git/ops"],
    enabled: !!importedProjectId && step === "progress" && !gitOpId,
    refetchInterval: 1000,
  });

  useEffect(() => {
    if (gitOps?.ops && gitOps.ops.length > 0 && !gitOpId) {
      setGitOpId(gitOps.ops[0].id);
    }
  }, [gitOps, gitOpId]);

  const handleValidateUrl = () => {
    if (url.trim()) {
      validateMutation.mutate(url.trim());
    }
  };

  const handleImport = () => {
    importMutation.mutate();
  };

  const handleComplete = () => {
    if (importedProjectId) {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      onImported?.(importedProjectId);
    }
    onOpenChange(false);
  };

  const renderUrlStep = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="repo-url">Repository URL</Label>
        <div className="flex gap-2">
          <Input
            id="repo-url"
            placeholder="https://github.com/owner/repo.git"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setValidation(null);
            }}
            data-testid="input-repo-url"
          />
          <Button
            variant="outline"
            onClick={handleValidateUrl}
            disabled={!url.trim() || validateMutation.isPending}
            data-testid="button-validate-url"
          >
            {validateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Validate"}
          </Button>
        </div>
        {validation && (
          <div className={`flex items-center gap-2 text-sm ${validation.valid ? "text-green-500" : "text-red-500"}`}>
            {validation.valid ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
            {validation.valid ? (
              <span>
                {validation.provider && <Badge variant="outline" className="mr-2">{validation.provider}</Badge>}
                {validation.owner}/{validation.repo}
              </span>
            ) : (
              <span>{validation.error}</span>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="branch">Branch (optional)</Label>
        <Input
          id="branch"
          placeholder="main"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          data-testid="input-branch"
        />
        <p className="text-xs text-muted-foreground">Leave empty to use the default branch</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="project-name">Project Name</Label>
        <Input
          id="project-name"
          placeholder="my-project"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          data-testid="input-project-name"
        />
      </div>
    </div>
  );

  const renderAuthStep = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Authentication</Label>
        <Select value={authType} onValueChange={(v) => setAuthType(v as "none" | "pat")}>
          <SelectTrigger data-testid="select-auth-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None (public repo)</SelectItem>
            <SelectItem value="pat">Personal Access Token</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {authType === "pat" && (
        <div className="space-y-2">
          <Label htmlFor="secret-key">Secret Key Name</Label>
          <Input
            id="secret-key"
            placeholder="GITHUB_PAT"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            data-testid="input-secret-key"
          />
          <p className="text-xs text-muted-foreground">
            Enter the name of the secret stored in your vault that contains the PAT.
          </p>
        </div>
      )}

      <div className="flex items-center space-x-2 pt-2">
        <Checkbox
          id="auto-start"
          checked={autoStartRun}
          onCheckedChange={(checked) => setAutoStartRun(checked === true)}
          data-testid="checkbox-auto-start"
        />
        <Label htmlFor="auto-start" className="text-sm cursor-pointer">
          Start agent run after import
        </Label>
      </div>
    </div>
  );

  const renderProgressStep = () => {
    const op = gitOpStatus || gitOps?.ops?.[0];
    const isComplete = op?.status === "succeeded";
    const isFailed = op?.status === "failed";

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          {!op || op.status === "queued" || op.status === "running" ? (
            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
          ) : isComplete ? (
            <Check className="h-6 w-6 text-green-500" />
          ) : (
            <AlertCircle className="h-6 w-6 text-red-500" />
          )}
          <div>
            <p className="font-medium">
              {!op ? "Starting clone..." : op.status === "queued" ? "Queued..." : op.status === "running" ? "Cloning repository..." : isComplete ? "Clone completed!" : "Clone failed"}
            </p>
            <p className="text-sm text-muted-foreground">
              {importedProjectId}
            </p>
          </div>
        </div>

        {op?.logTail && (
          <ScrollArea className="h-32 rounded border bg-muted/50 p-2">
            <pre className="text-xs font-mono whitespace-pre-wrap">{op.logTail}</pre>
          </ScrollArea>
        )}

        {isFailed && op?.error && (
          <div className="rounded border border-red-500/50 bg-red-500/10 p-3">
            <p className="text-sm text-red-500">{op.error}</p>
          </div>
        )}

        {isComplete && (
          <div className="rounded border border-green-500/50 bg-green-500/10 p-3 space-y-2">
            <p className="text-sm text-green-500">Repository cloned and bootstrapped successfully!</p>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• Project files created</li>
              <li>• Stack detected and configured</li>
              <li>• Search index built</li>
            </ul>
          </div>
        )}
      </div>
    );
  };

  const canProceed = () => {
    switch (step) {
      case "url":
        return validation?.valid && projectName.trim().length > 0;
      case "auth":
        return authType === "none" || (authType === "pat" && secretKey.trim().length > 0);
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (step === "url") setStep("auth");
    else if (step === "auth") handleImport();
  };

  const handleBack = () => {
    if (step === "auth") setStep("url");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="modal-import-repo">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderGit2 className="h-5 w-5" />
            Import Git Repository
          </DialogTitle>
          <DialogDescription>
            {step === "url" && "Enter the repository URL to import"}
            {step === "auth" && "Configure authentication and options"}
            {step === "progress" && "Importing repository..."}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {step === "url" && renderUrlStep()}
          {step === "auth" && renderAuthStep()}
          {step === "progress" && renderProgressStep()}
        </div>

        <DialogFooter>
          {step === "progress" ? (
            <Button
              onClick={handleComplete}
              disabled={gitOpStatus?.status !== "succeeded" && gitOpStatus?.status !== "failed"}
              data-testid="button-done"
            >
              {gitOpStatus?.status === "succeeded" ? "Open Project" : "Close"}
            </Button>
          ) : (
            <>
              {step !== "url" && (
                <Button variant="outline" onClick={handleBack} data-testid="button-back">
                  Back
                </Button>
              )}
              <Button
                onClick={handleNext}
                disabled={!canProceed() || importMutation.isPending}
                data-testid="button-next"
              >
                {importMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                {step === "auth" ? "Import" : "Next"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
