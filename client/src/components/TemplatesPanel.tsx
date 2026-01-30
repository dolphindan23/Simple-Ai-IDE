import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Package, Search, Play, ChevronRight, AlertCircle, CheckCircle, Lock, ExternalLink, Tag, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface TemplateVariable {
  default: string;
  description?: string;
}

interface TemplateSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  tags: string[];
  extends: string[];
  requiresSecrets: string[];
}

interface TemplateDetail extends TemplateSummary {
  variables?: Record<string, TemplateVariable>;
  creates?: {
    files: string[];
    endpoints?: string[];
  };
  postInstall?: { type: string; cmd: string }[];
}

interface ApplyResult {
  status: string;
  runId: string;
  createdFiles?: string[];
  patchSummary?: {
    filesChanged: number;
    insertions: number;
  };
  approvalReasons?: { type: string; paths?: string[]; details?: string }[];
  requiresSecrets?: string[];
}

interface TemplatesPanelProps {
  projectId: string | null;
  compact?: boolean;
}

function TemplateCard({ 
  template, 
  onSelect 
}: { 
  template: TemplateSummary; 
  onSelect: () => void;
}) {
  return (
    <Card 
      className="hover-elevate cursor-pointer group" 
      onClick={onSelect}
      data-testid={`template-card-${template.id}`}
    >
      <CardHeader className="p-3 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-medium">{template.name}</CardTitle>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <CardDescription className="text-xs line-clamp-2">{template.description}</CardDescription>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <div className="flex flex-wrap gap-1">
          {template.tags.slice(0, 3).map(tag => (
            <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
              {tag}
            </Badge>
          ))}
          {template.extends.length > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              extends: {template.extends[0]}
            </Badge>
          )}
        </div>
        {template.requiresSecrets.length > 0 && (
          <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground">
            <Lock className="h-3 w-3" />
            {template.requiresSecrets.length} secret{template.requiresSecrets.length > 1 ? 's' : ''} required
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ApplyTemplateModal({
  template,
  projectId,
  open,
  onOpenChange,
  onApplied,
}: {
  template: TemplateDetail | null;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: (result: ApplyResult) => void;
}) {
  const [variables, setVariables] = useState<Record<string, string>>({});
  
  const applyMutation = useMutation({
    mutationFn: async ({ templateId, vars }: { templateId: string; vars: Record<string, string> }) => {
      const response = await apiRequest("POST", `/api/v1/projects/${projectId}/templates/apply`, {
        templateId,
        variables: vars,
      });
      return response.json();
    },
    onSuccess: (data) => {
      onApplied(data);
      if (data.status === "applied" || data.status === "staged") {
        onOpenChange(false);
        queryClient.invalidateQueries({ queryKey: ["/api/v1/projects", projectId, "capabilities"] });
      }
    },
  });

  if (!template) return null;

  const variableEntries = Object.entries(template.variables || {});
  const hasVariables = variableEntries.length > 0;

  const handleApply = () => {
    const finalVariables: Record<string, string> = {};
    variableEntries.forEach(([key, val]) => {
      finalVariables[key] = variables[key] || val.default;
    });
    applyMutation.mutate({ templateId: template.id, vars: finalVariables });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="modal-apply-template">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Apply {template.name}
          </DialogTitle>
          <DialogDescription>{template.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {hasVariables && (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Configuration Variables</Label>
              {variableEntries.map(([key, varDef]) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={key} className="text-xs text-muted-foreground">{key}</Label>
                  <Input
                    id={key}
                    placeholder={varDef.default}
                    value={variables[key] || ""}
                    onChange={(e) => setVariables(prev => ({ ...prev, [key]: e.target.value }))}
                    data-testid={`input-var-${key}`}
                  />
                  {varDef.description && (
                    <p className="text-[10px] text-muted-foreground">{varDef.description}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {template.requiresSecrets.length > 0 && (
            <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-center gap-2 text-amber-500 text-sm font-medium mb-1">
                <Lock className="h-4 w-4" />
                Required Secrets
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                This template requires the following secrets to be configured:
              </p>
              <div className="flex flex-wrap gap-1">
                {template.requiresSecrets.map(secret => (
                  <Badge key={secret} variant="outline" className="text-xs font-mono">
                    {secret}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {template.creates && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Files to Create</Label>
              <div className="text-xs text-muted-foreground space-y-0.5 max-h-24 overflow-y-auto font-mono bg-muted/50 p-2 rounded">
                {template.creates.files.map(file => (
                  <div key={file}>{file}</div>
                ))}
              </div>
            </div>
          )}

          {applyMutation.error && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" />
                {(applyMutation.error as Error).message}
              </div>
            </div>
          )}

          {applyMutation.data?.status === "needs_approval" && (
            <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-center gap-2 text-amber-500 text-sm font-medium mb-1">
                <AlertCircle className="h-4 w-4" />
                Approval Required
              </div>
              <p className="text-xs text-muted-foreground">
                Some files require manual approval before being written. Check the pending writes in the run details.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleApply} 
            disabled={applyMutation.isPending}
            data-testid="button-apply-template"
          >
            {applyMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Applying...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Apply Template
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TemplatesPanel({ projectId, compact }: TemplatesPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [lastApplyResult, setLastApplyResult] = useState<ApplyResult | null>(null);

  const { data: templatesData, isLoading: templatesLoading } = useQuery<{ templates: TemplateSummary[] }>({
    queryKey: ["/api/v1/templates"],
  });

  const { data: templateDetail } = useQuery<{ template: TemplateDetail }>({
    queryKey: ["/api/v1/templates", selectedTemplateId],
    enabled: !!selectedTemplateId,
  });

  const { data: capabilities } = useQuery({
    queryKey: ["/api/v1/projects", projectId, "capabilities"],
    enabled: !!projectId,
  });

  const templates = templatesData?.templates || [];
  const filteredTemplates = templates.filter(t => 
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    setApplyModalOpen(true);
  };

  const handleApplied = (result: ApplyResult) => {
    setLastApplyResult(result);
    if (result.status === "applied" || result.status === "staged") {
      setSelectedTemplateId(null);
    }
  };

  if (!projectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center text-muted-foreground">
        <Package className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">Select a project to view templates</p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", compact && "max-h-64")}>
      <div className="p-2 space-y-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-7 text-xs"
            data-testid="input-search-templates"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 px-2 pb-2">
        {templatesLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <Package className="h-6 w-6 mb-2 opacity-50" />
            <p className="text-xs">No templates found</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredTemplates.map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                onSelect={() => handleSelectTemplate(template.id)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {(lastApplyResult?.status === "applied" || lastApplyResult?.status === "staged") && (
        <div className="p-2 border-t">
          <div className="flex items-center gap-2 text-green-500 text-xs">
            <CheckCircle className="h-3.5 w-3.5" />
            <span>Template staged: {lastApplyResult.createdFiles?.length || 0} files ready to apply</span>
          </div>
          {lastApplyResult.runId && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Run ID: {lastApplyResult.runId}
            </p>
          )}
        </div>
      )}

      <ApplyTemplateModal
        template={templateDetail?.template || null}
        projectId={projectId}
        open={applyModalOpen}
        onOpenChange={setApplyModalOpen}
        onApplied={handleApplied}
      />
    </div>
  );
}
