import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  RefreshCw, Server, AlertCircle, CheckCircle, 
  Cpu, Zap, Scale, Gauge, Hash, Edit2, Save, X, 
  HelpCircle, Code, Eye, MessageSquare, Database, 
  Brain, Wrench, ChevronDown, ChevronUp, BookOpen
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface ModelInferred {
  type: string;
  sizeClass: string;
  preference: string;
}

interface ModelUserTags {
  type?: "code" | "general" | "reasoning" | "vision" | "tool" | "embed";
  preference?: "fast" | "balanced" | "accurate";
  defaultNumCtx?: number;
  notes?: string;
}

interface ModelInfo {
  name: string;
  size?: number;
  modifiedAt?: string;
  details?: any;
  inferred: ModelInferred;
  userTags?: ModelUserTags;
}

interface BackendModels {
  backendId: string;
  backendName: string;
  backendUrl: string;
  online: boolean;
  models: ModelInfo[];
  error?: string;
}

interface ModelsResponse {
  backends: BackendModels[];
  catalog: {
    models: Record<string, ModelUserTags>;
    updatedAt?: string;
  };
}

const TYPE_ICONS: Record<string, any> = {
  code: Code,
  general: MessageSquare,
  reasoning: Brain,
  vision: Eye,
  tool: Wrench,
  embed: Database,
  unknown: HelpCircle,
};

const TYPE_COLORS: Record<string, string> = {
  code: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  general: "bg-green-500/20 text-green-400 border-green-500/30",
  reasoning: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  vision: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  tool: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  embed: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  unknown: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

const SIZE_COLORS: Record<string, string> = {
  small: "bg-emerald-500/20 text-emerald-400",
  medium: "bg-yellow-500/20 text-yellow-400",
  large: "bg-orange-500/20 text-orange-400",
  xlarge: "bg-red-500/20 text-red-400",
  unknown: "bg-gray-500/20 text-gray-400",
};

const PREFERENCE_ICONS: Record<string, any> = {
  fast: Zap,
  balanced: Scale,
  accurate: Gauge,
};

function formatBytes(bytes?: number): string {
  if (!bytes) return "N/A";
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function EducationalTooltip({ concept, children }: { concept: string; children: React.ReactNode }) {
  const explanations: Record<string, string> = {
    type: "Model Type indicates primary use case. Code models excel at syntax and diffs. General models handle planning and conversations. Reasoning models tackle complex multi-step problems. Vision models process images. Tool models excel at structured output and orchestration. Embed models create vector representations.",
    size: "Size Class reflects parameter count. Smaller models (1-3B) are faster but less capable. Medium models (7-8B) balance speed and quality. Large models (13B+) offer best quality but require more resources.",
    preference: "Speed vs Quality trade-off. Fast models respond quickly with simpler answers. Balanced models offer good quality at moderate speed. Accurate models take longer but provide more nuanced responses.",
    context: "Context Length (num_ctx) determines how much text the model can process at once. Higher values allow longer conversations or larger code files, but use more memory. Common values: 2048 (minimal), 4096 (default), 8192 (large), 32768 (extended).",
    temperature: "Temperature controls response randomness. Lower values (0.1-0.3) produce focused, deterministic outputs ideal for code. Higher values (0.7-1.0) enable creative, varied responses for open-ended tasks.",
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-xs p-3 text-sm">
        <p>{explanations[concept] || "Information about this setting."}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// Comprehensive educational content about model types
const MODEL_TYPE_INFO = [
  {
    type: "code",
    icon: Code,
    name: "Code-Tuned",
    tagline: "Best when the output must compile",
    strengths: ["Lowest hallucination rate for code", "Strong with diffs and patches", "Good at fixing compiler/test errors"],
    weaknesses: ["Not great at high-level planning", "May miss intent focusing on syntax"],
    bestFor: ["Writing code", "Refactoring", "Fixing tests", "Generating patches"],
  },
  {
    type: "general",
    icon: MessageSquare,
    name: "General / Chat",
    tagline: "Best when the output must make sense",
    strengths: ["Good architectural thinking", "Better explanations", "Strong at 'what should we do?'"],
    weaknesses: ["Higher chance of code hallucinations", "Less strict about formatting"],
    bestFor: ["Task breakdown", "Planning", "Code review", "Writing docs"],
  },
  {
    type: "reasoning",
    icon: Brain,
    name: "Deep Reasoning",
    tagline: "Best when the problem is hard, not when the code is long",
    strengths: ["Best for tricky bugs", "Better at understanding legacy code", "Strong at 'why is this broken?'"],
    weaknesses: ["Slower responses", "Often worse at raw code formatting"],
    bestFor: ["Debugging complex issues", "Root-cause analysis", "Reviewing architectural changes"],
  },
  {
    type: "vision",
    icon: Eye,
    name: "Vision / Multimodal",
    tagline: "Best when the input is visual",
    strengths: ["Understands UI layouts", "Can compare designs to code", "Reads screenshots and diagrams"],
    weaknesses: ["Usually weaker at pure code writing", "Slower and heavier"],
    bestFor: ["Screenshot to components", "UI consistency checks", "Design-to-code"],
  },
  {
    type: "tool",
    icon: Wrench,
    name: "Tool-Using / Agentic",
    tagline: "Best when the system is driving the workflow",
    strengths: ["Reliable orchestration", "Works well with planners", "Follows structured contracts"],
    weaknesses: ["Often less creative", "Can be verbose or rigid"],
    bestFor: ["Workflow execution", "Tool calling", "Structured output"],
  },
  {
    type: "embed",
    icon: Database,
    name: "Embedding",
    tagline: "Best for search and similarity",
    strengths: ["Creates dense vector representations", "Fast similarity search", "Good for RAG systems"],
    weaknesses: ["Cannot generate text", "Only produces embeddings"],
    bestFor: ["Semantic search", "Document retrieval", "Similarity matching"],
  },
];

const TASK_TO_TYPE_MAP = [
  { task: "Plan a feature", types: ["general", "reasoning"] },
  { task: "Generate patch diff", types: ["code"] },
  { task: "Refactor codebase", types: ["code"] },
  { task: "Fix failing tests", types: ["code"] },
  { task: "Debug complex bug", types: ["reasoning"] },
  { task: "Review a change", types: ["general", "reasoning"] },
  { task: "Write documentation", types: ["general"] },
  { task: "Quick rename/format", types: ["code"] },
  { task: "Understand UI screenshot", types: ["vision"] },
  { task: "Orchestrate tools", types: ["tool"] },
];

function ModelGuidePanel() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="overflow-hidden">
        <CollapsibleTrigger asChild>
          <button 
            className="w-full p-3 flex items-center justify-between hover-elevate text-left"
            data-testid="button-toggle-model-guide"
          >
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">How to Choose a Model</span>
            </div>
            {isOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-4 border-t pt-3">
            <p className="text-xs text-muted-foreground">
              Think of models as tools, not personalities. Each type excels at different tasks.
              Tags marked with <span className="opacity-60">*</span> have been customized by you.
            </p>

            <div className="space-y-3">
              <h4 className="text-xs font-medium uppercase text-muted-foreground">Model Types</h4>
              <div className="grid gap-2">
                {MODEL_TYPE_INFO.map((info) => {
                  const Icon = info.icon;
                  return (
                    <div 
                      key={info.type} 
                      className="p-2 rounded-md bg-muted/30 space-y-1"
                    >
                      <div className="flex items-center gap-2">
                        <Badge 
                          variant="outline" 
                          className={`text-[10px] px-1.5 py-0 h-5 ${TYPE_COLORS[info.type]}`}
                        >
                          <Icon className="h-2.5 w-2.5 mr-1" />
                          {info.type}
                        </Badge>
                        <span className="text-xs font-medium">{info.name}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground italic">"{info.tagline}"</p>
                      <div className="grid grid-cols-2 gap-2 mt-1">
                        <div>
                          <p className="text-[10px] text-green-500/80 font-medium">Strengths:</p>
                          <ul className="text-[10px] text-muted-foreground list-disc list-inside">
                            {info.strengths.slice(0, 2).map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        </div>
                        <div>
                          <p className="text-[10px] text-orange-500/80 font-medium">Weaknesses:</p>
                          <ul className="text-[10px] text-muted-foreground list-disc list-inside">
                            {info.weaknesses.slice(0, 2).map((w, i) => <li key={i}>{w}</li>)}
                          </ul>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-medium uppercase text-muted-foreground">Task to Model Type</h4>
              <p className="text-[10px] text-muted-foreground">
                This is educational guidance, not a rule. You can use any model for any task.
              </p>
              <div className="grid grid-cols-2 gap-1">
                {TASK_TO_TYPE_MAP.map((item) => (
                  <div key={item.task} className="flex items-center justify-between text-[10px] py-0.5">
                    <span className="text-muted-foreground">{item.task}</span>
                    <div className="flex gap-0.5">
                      {item.types.map((t) => {
                        const Icon = TYPE_ICONS[t] || HelpCircle;
                        return (
                          <Badge 
                            key={t}
                            variant="outline" 
                            className={`text-[9px] px-1 py-0 h-4 ${TYPE_COLORS[t]}`}
                          >
                            <Icon className="h-2 w-2" />
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-medium uppercase text-muted-foreground">Size vs Speed Tradeoffs</h4>
              <div className="text-[10px] text-muted-foreground space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={`text-[9px] px-1 py-0 h-4 ${SIZE_COLORS.small}`}>
                    <Zap className="h-2 w-2 mr-0.5" />small
                  </Badge>
                  <span>1-3B params: Instant responses, great for quick tasks</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={`text-[9px] px-1 py-0 h-4 ${SIZE_COLORS.medium}`}>
                    <Scale className="h-2 w-2 mr-0.5" />medium
                  </Badge>
                  <span>7-8B params: Balance of speed and capability</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={`text-[9px] px-1 py-0 h-4 ${SIZE_COLORS.large}`}>
                    <Gauge className="h-2 w-2 mr-0.5" />large
                  </Badge>
                  <span>13B+ params: Better reasoning, more memory needed</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-medium uppercase text-muted-foreground">Temperature Guide</h4>
              <div className="text-[10px] text-muted-foreground">
                <p><strong>Low (0.1-0.3):</strong> Focused, deterministic. Best for code generation.</p>
                <p><strong>Medium (0.4-0.7):</strong> Balanced creativity and consistency.</p>
                <p><strong>High (0.8-1.0):</strong> Creative, varied. Best for brainstorming.</p>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function ModelCard({ 
  model, 
  backendId,
  onTagsUpdated 
}: { 
  model: ModelInfo; 
  backendId: string;
  onTagsUpdated: () => void;
}) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editTags, setEditTags] = useState<ModelUserTags>(model.userTags || {});

  const saveMutation = useMutation({
    mutationFn: async (tags: ModelUserTags) => {
      return apiRequest("PUT", `/api/ai/model-catalog/${encodeURIComponent(model.name)}`, tags);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/models"] });
      toast({ title: "Tags saved", description: `Updated tags for ${model.name}` });
      setIsEditing(false);
      onTagsUpdated();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const effectiveType = model.userTags?.type || model.inferred.type;
  const effectivePreference = model.userTags?.preference || model.inferred.preference;
  const TypeIcon = TYPE_ICONS[effectiveType] || HelpCircle;
  const PreferenceIcon = PREFERENCE_ICONS[effectivePreference] || Scale;

  return (
    <Card 
      className="p-3 space-y-2 hover-elevate"
      data-testid={`model-card-${model.name.replace(/[^a-zA-Z0-9]/g, "-")}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm truncate" title={model.name}>
            {model.name}
          </h4>
          <p className="text-xs text-muted-foreground">
            {formatBytes(model.size)}
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setIsEditing(!isEditing)}
          data-testid={`button-edit-tags-${model.name.replace(/[^a-zA-Z0-9]/g, "-")}`}
        >
          {isEditing ? <X className="h-3.5 w-3.5" /> : <Edit2 className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {isEditing ? (
        <div className="space-y-3 pt-2 border-t">
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <EducationalTooltip concept="type">
                <Label className="text-xs flex items-center gap-1 cursor-help">
                  Type <HelpCircle className="h-3 w-3 text-muted-foreground" />
                </Label>
              </EducationalTooltip>
            </div>
            <Select
              value={editTags.type || ""}
              onValueChange={(v) => setEditTags(prev => ({ ...prev, type: v as any || undefined }))}
            >
              <SelectTrigger className="h-8 text-xs" data-testid="select-model-type">
                <SelectValue placeholder={`Auto: ${model.inferred.type}`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Auto-detect</SelectItem>
                <SelectItem value="code">Code</SelectItem>
                <SelectItem value="general">General / Chat</SelectItem>
                <SelectItem value="reasoning">Deep Reasoning</SelectItem>
                <SelectItem value="vision">Vision</SelectItem>
                <SelectItem value="tool">Tool-Using</SelectItem>
                <SelectItem value="embed">Embedding</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <EducationalTooltip concept="preference">
                <Label className="text-xs flex items-center gap-1 cursor-help">
                  Preference <HelpCircle className="h-3 w-3 text-muted-foreground" />
                </Label>
              </EducationalTooltip>
            </div>
            <Select
              value={editTags.preference || ""}
              onValueChange={(v) => setEditTags(prev => ({ ...prev, preference: v as any || undefined }))}
            >
              <SelectTrigger className="h-8 text-xs" data-testid="select-model-preference">
                <SelectValue placeholder={`Auto: ${model.inferred.preference}`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Auto-detect</SelectItem>
                <SelectItem value="fast">Fast</SelectItem>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="accurate">Accurate</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <EducationalTooltip concept="context">
                <Label className="text-xs flex items-center gap-1 cursor-help">
                  Default Context <HelpCircle className="h-3 w-3 text-muted-foreground" />
                </Label>
              </EducationalTooltip>
            </div>
            <Input
              type="number"
              className="h-8 text-xs"
              placeholder="e.g., 4096"
              value={editTags.defaultNumCtx || ""}
              onChange={(e) => setEditTags(prev => ({ 
                ...prev, 
                defaultNumCtx: e.target.value ? parseInt(e.target.value) : undefined 
              }))}
              data-testid="input-model-context"
            />
          </div>

          <div className="grid gap-2">
            <Label className="text-xs">Notes</Label>
            <Input
              className="h-8 text-xs"
              placeholder="Optional notes..."
              value={editTags.notes || ""}
              onChange={(e) => setEditTags(prev => ({ ...prev, notes: e.target.value || undefined }))}
              data-testid="input-model-notes"
            />
          </div>

          <Button 
            size="sm" 
            className="w-full h-7 text-xs"
            onClick={() => saveMutation.mutate(editTags)}
            disabled={saveMutation.isPending}
            data-testid="button-save-model-tags"
          >
            <Save className="h-3 w-3 mr-1" />
            Save Tags
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <EducationalTooltip concept="type">
            <Badge 
              variant="outline" 
              className={`text-[10px] px-1.5 py-0 h-5 cursor-help ${TYPE_COLORS[effectiveType]}`}
            >
              <TypeIcon className="h-2.5 w-2.5 mr-1" />
              {effectiveType}
              {model.userTags?.type && <span className="ml-0.5 opacity-60">*</span>}
            </Badge>
          </EducationalTooltip>

          <EducationalTooltip concept="size">
            <Badge 
              variant="outline" 
              className={`text-[10px] px-1.5 py-0 h-5 cursor-help ${SIZE_COLORS[model.inferred.sizeClass]}`}
            >
              <Cpu className="h-2.5 w-2.5 mr-1" />
              {model.inferred.sizeClass}
            </Badge>
          </EducationalTooltip>

          <EducationalTooltip concept="preference">
            <Badge 
              variant="outline" 
              className="text-[10px] px-1.5 py-0 h-5 cursor-help"
            >
              <PreferenceIcon className="h-2.5 w-2.5 mr-1" />
              {effectivePreference}
              {model.userTags?.preference && <span className="ml-0.5 opacity-60">*</span>}
            </Badge>
          </EducationalTooltip>

          {(model.userTags?.defaultNumCtx) && (
            <EducationalTooltip concept="context">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 cursor-help">
                <Hash className="h-2.5 w-2.5 mr-1" />
                {model.userTags.defaultNumCtx}
              </Badge>
            </EducationalTooltip>
          )}
        </div>
      )}

      {model.userTags?.notes && !isEditing && (
        <p className="text-xs text-muted-foreground italic truncate" title={model.userTags.notes}>
          {model.userTags.notes}
        </p>
      )}
    </Card>
  );
}

export function ModelCatalog() {
  const { toast } = useToast();

  const { data, isLoading, refetch, isRefetching } = useQuery<ModelsResponse>({
    queryKey: ["/api/ai/models"],
  });

  const handleRefresh = async () => {
    await refetch();
    toast({ title: "Catalog refreshed", description: "Fetched latest models from all backends." });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const backends = data?.backends || [];
  const totalModels = backends.reduce((sum, b) => sum + b.models.length, 0);
  const onlineBackends = backends.filter(b => b.online).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Model Catalog</h3>
          <p className="text-xs text-muted-foreground">
            {totalModels} models from {onlineBackends}/{backends.length} backends
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRefresh}
          disabled={isRefetching}
          data-testid="button-refresh-models"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-2 ${isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <ModelGuidePanel />

      {backends.length === 0 && (
        <Card className="p-6 text-center">
          <Server className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
          <p className="text-sm text-muted-foreground">No backends configured</p>
          <p className="text-xs text-muted-foreground">Add a backend in the Backends tab to see available models</p>
        </Card>
      )}

      {backends.map((backend) => (
        <div key={backend.backendId} className="space-y-2">
          <div className="flex items-center gap-2">
            {backend.online ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-500" />
            )}
            <h4 className="text-sm font-medium">{backend.backendName}</h4>
            <Badge variant="outline" className="text-[10px]">
              {backend.models.length} models
            </Badge>
            {!backend.online && backend.error && (
              <span className="text-xs text-red-500">{backend.error}</span>
            )}
          </div>

          {backend.online && backend.models.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {backend.models.map((model) => (
                <ModelCard
                  key={`${backend.backendId}-${model.name}`}
                  model={model}
                  backendId={backend.backendId}
                  onTagsUpdated={() => refetch()}
                />
              ))}
            </div>
          ) : backend.online ? (
            <Card className="p-4 text-center text-muted-foreground text-sm">
              No models found on this backend
            </Card>
          ) : null}
        </div>
      ))}
    </div>
  );
}
