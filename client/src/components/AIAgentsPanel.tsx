import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Server, Plus, Trash2, Edit2, Check, X, Loader2, 
  CheckCircle, XCircle, Bot, Cpu, Thermometer, Hash
} from "lucide-react";
import type { 
  Settings as SettingsType, 
  BackendConfig, 
  AuthType, 
  AgentRole, 
  RoleConfig 
} from "@shared/schema";

const AGENT_ROLES: AgentRole[] = ["Planner", "Coder", "Reviewer", "TestFixer", "Doc"];

const ROLE_DESCRIPTIONS: Record<AgentRole, string> = {
  Planner: "Creates implementation plans and breaks down tasks",
  Coder: "Writes and implements code changes",
  Reviewer: "Reviews code for issues and improvements",
  TestFixer: "Fixes failing tests and debugging",
  Doc: "Generates documentation and comments",
};

interface BackendTestResult {
  success: boolean;
  models?: string[];
  error?: string;
}

interface VaultStatus {
  exists: boolean;
  unlocked: boolean;
}

export function AIAgentsPanel() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [editingBackend, setEditingBackend] = useState<BackendConfig | null>(null);
  const [newBackend, setNewBackend] = useState<Partial<BackendConfig>>({
    name: "",
    baseUrl: "http://localhost:11434",
    authType: "none",
  });
  const [isAddingBackend, setIsAddingBackend] = useState(false);
  const [testingBackendId, setTestingBackendId] = useState<string | null>(null);
  const [backendModels, setBackendModels] = useState<Record<string, string[]>>({});
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>({ exists: false, unlocked: false });
  
  const [credentialInputs, setCredentialInputs] = useState<Record<string, { username?: string; password?: string; token?: string }>>({});

  const { data: savedSettings, isLoading } = useQuery<SettingsType>({
    queryKey: ["/api/settings"],
  });

  useEffect(() => {
    if (savedSettings) {
      setSettings(savedSettings);
    }
  }, [savedSettings]);

  useEffect(() => {
    fetchVaultStatus();
  }, []);

  const fetchVaultStatus = async () => {
    try {
      const res = await fetch("/api/secrets/status");
      const data = await res.json();
      setVaultStatus(data);
    } catch (error) {
      console.error("Failed to fetch vault status:", error);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async (newSettings: SettingsType) => {
      return apiRequest("PUT", "/api/settings", newSettings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings saved", description: "AI Agents configuration updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const generateBackendId = () => `backend_${Date.now()}`;

  const addBackend = async () => {
    if (!settings || !newBackend.name || !newBackend.baseUrl) {
      toast({ title: "Error", description: "Name and URL are required", variant: "destructive" });
      return;
    }

    const backend: BackendConfig = {
      id: generateBackendId(),
      name: newBackend.name,
      baseUrl: newBackend.baseUrl,
      authType: newBackend.authType || "none",
    };

    if (backend.authType !== "none" && vaultStatus.unlocked) {
      const creds = credentialInputs[backend.id] || {};
      if (backend.authType === "basic" && creds.username && creds.password) {
        await saveCredential(backend.id, "username", creds.username);
        await saveCredential(backend.id, "password", creds.password);
      } else if (backend.authType === "bearer" && creds.token) {
        await saveCredential(backend.id, "token", creds.token);
      }
    }

    const updatedSettings = {
      ...settings,
      aiAgents: {
        ...settings.aiAgents,
        backends: [...(settings.aiAgents?.backends || []), backend],
        defaultBackendId: settings.aiAgents?.defaultBackendId || backend.id,
      },
    };

    setSettings(updatedSettings);
    saveMutation.mutate(updatedSettings);
    setNewBackend({ name: "", baseUrl: "http://localhost:11434", authType: "none" });
    setCredentialInputs({});
    setIsAddingBackend(false);
  };

  const saveCredential = async (backendId: string, field: string, value: string) => {
    try {
      const key = `BACKEND_${backendId}_${field.toUpperCase()}`;
      await apiRequest("PUT", `/api/secrets/${key}`, { value });
    } catch (error) {
      console.error("Failed to save credential:", error);
    }
  };

  const updateBackend = async (backend: BackendConfig) => {
    if (!settings) return;

    const creds = credentialInputs[backend.id] || {};
    if (backend.authType !== "none" && vaultStatus.unlocked) {
      if (backend.authType === "basic") {
        if (creds.username) await saveCredential(backend.id, "username", creds.username);
        if (creds.password) await saveCredential(backend.id, "password", creds.password);
      } else if (backend.authType === "bearer" && creds.token) {
        await saveCredential(backend.id, "token", creds.token);
      }
    }

    const updatedSettings = {
      ...settings,
      aiAgents: {
        ...settings.aiAgents,
        backends: settings.aiAgents.backends.map(b => 
          b.id === backend.id ? backend : b
        ),
      },
    };

    setSettings(updatedSettings);
    saveMutation.mutate(updatedSettings);
    setEditingBackend(null);
    setCredentialInputs(prev => {
      const next = { ...prev };
      delete next[backend.id];
      return next;
    });
  };

  const deleteBackend = (backendId: string) => {
    if (!settings) return;

    const updatedSettings = {
      ...settings,
      aiAgents: {
        ...settings.aiAgents,
        backends: settings.aiAgents.backends.filter(b => b.id !== backendId),
        defaultBackendId: settings.aiAgents.defaultBackendId === backendId 
          ? settings.aiAgents.backends.find(b => b.id !== backendId)?.id 
          : settings.aiAgents.defaultBackendId,
      },
    };

    setSettings(updatedSettings);
    saveMutation.mutate(updatedSettings);
  };

  const testBackend = async (backend: BackendConfig) => {
    setTestingBackendId(backend.id);
    try {
      const res = await fetch("/api/ai-agents/test-backend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backendId: backend.id }),
      });
      const result: BackendTestResult = await res.json();
      
      if (result.success && result.models) {
        setBackendModels(prev => ({ ...prev, [backend.id]: result.models! }));
        toast({ 
          title: "Connection successful", 
          description: `Found ${result.models.length} models available.` 
        });
      } else {
        toast({ 
          title: "Connection failed", 
          description: result.error || "Unable to connect to backend", 
          variant: "destructive" 
        });
      }
    } catch (error: any) {
      toast({ 
        title: "Connection failed", 
        description: error.message, 
        variant: "destructive" 
      });
    } finally {
      setTestingBackendId(null);
    }
  };

  const setDefaultBackend = (backendId: string) => {
    if (!settings) return;

    const updatedSettings = {
      ...settings,
      aiAgents: {
        ...settings.aiAgents,
        defaultBackendId: backendId,
      },
    };

    setSettings(updatedSettings);
    saveMutation.mutate(updatedSettings);
  };

  const updateRoleConfig = (role: AgentRole, config: Partial<RoleConfig>) => {
    if (!settings) return;

    const currentConfig = settings.aiAgents.roles[role] || {
      backendId: settings.aiAgents.defaultBackendId || "",
      model: "",
      temperature: 0.7,
      numCtx: 4096,
    };

    const updatedSettings = {
      ...settings,
      aiAgents: {
        ...settings.aiAgents,
        roles: {
          ...settings.aiAgents.roles,
          [role]: { ...currentConfig, ...config },
        },
      },
    };

    setSettings(updatedSettings);
    saveMutation.mutate(updatedSettings);
  };

  const backends = settings?.aiAgents?.backends || [];
  const roles = settings?.aiAgents?.roles || {};
  const defaultBackendId = settings?.aiAgents?.defaultBackendId;

  const getAvailableModels = (backendId: string): string[] => {
    return backendModels[backendId] || [];
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <Tabs defaultValue="backends" className="h-full">
        <TabsList className="mb-4">
          <TabsTrigger value="backends" data-testid="tab-backends">
            <Server className="w-4 h-4 mr-2" />
            Backends
          </TabsTrigger>
          <TabsTrigger value="roles" data-testid="tab-roles">
            <Bot className="w-4 h-4 mr-2" />
            Agent Roles
          </TabsTrigger>
        </TabsList>

        <TabsContent value="backends" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">LLM Backends</h3>
            <Button 
              size="sm" 
              onClick={() => setIsAddingBackend(true)}
              disabled={isAddingBackend}
              data-testid="button-add-backend"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Backend
            </Button>
          </div>

          {!vaultStatus.unlocked && (
            <Card className="p-3 bg-yellow-500/10 border-yellow-500/30">
              <p className="text-sm text-yellow-600 dark:text-yellow-400">
                Unlock the secrets vault in Settings to store backend credentials securely.
              </p>
            </Card>
          )}

          {isAddingBackend && (
            <Card className="p-4 space-y-4">
              <h4 className="font-medium">New Backend</h4>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="new-backend-name">Name</Label>
                  <Input
                    id="new-backend-name"
                    placeholder="My Ollama Server"
                    value={newBackend.name || ""}
                    onChange={e => setNewBackend(prev => ({ ...prev, name: e.target.value }))}
                    data-testid="input-backend-name"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="new-backend-url">Base URL</Label>
                  <Input
                    id="new-backend-url"
                    placeholder="http://localhost:11434"
                    value={newBackend.baseUrl || ""}
                    onChange={e => setNewBackend(prev => ({ ...prev, baseUrl: e.target.value }))}
                    data-testid="input-backend-url"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Authentication</Label>
                  <Select
                    value={newBackend.authType || "none"}
                    onValueChange={v => setNewBackend(prev => ({ ...prev, authType: v as AuthType }))}
                  >
                    <SelectTrigger data-testid="select-auth-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="basic">Basic Auth</SelectItem>
                      <SelectItem value="bearer">Bearer Token</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {newBackend.authType === "basic" && vaultStatus.unlocked && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label>Username</Label>
                      <Input
                        placeholder="Username"
                        value={credentialInputs["new"]?.username || ""}
                        onChange={e => setCredentialInputs(prev => ({
                          ...prev,
                          new: { ...prev["new"], username: e.target.value }
                        }))}
                        data-testid="input-auth-username"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Password</Label>
                      <Input
                        type="password"
                        placeholder="Password"
                        value={credentialInputs["new"]?.password || ""}
                        onChange={e => setCredentialInputs(prev => ({
                          ...prev,
                          new: { ...prev["new"], password: e.target.value }
                        }))}
                        data-testid="input-auth-password"
                      />
                    </div>
                  </div>
                )}

                {newBackend.authType === "bearer" && vaultStatus.unlocked && (
                  <div className="grid gap-2">
                    <Label>Token</Label>
                    <Input
                      type="password"
                      placeholder="Bearer token"
                      value={credentialInputs["new"]?.token || ""}
                      onChange={e => setCredentialInputs(prev => ({
                        ...prev,
                        new: { ...prev["new"], token: e.target.value }
                      }))}
                      data-testid="input-auth-token"
                    />
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button size="sm" onClick={addBackend} data-testid="button-save-backend">
                  <Check className="w-4 h-4 mr-2" />
                  Save
                </Button>
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={() => {
                    setIsAddingBackend(false);
                    setNewBackend({ name: "", baseUrl: "http://localhost:11434", authType: "none" });
                  }}
                  data-testid="button-cancel-backend"
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
              </div>
            </Card>
          )}

          <div className="space-y-3">
            {backends.length === 0 && !isAddingBackend && (
              <Card className="p-6 text-center text-muted-foreground">
                <Server className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No backends configured</p>
                <p className="text-sm">Add an LLM backend to get started</p>
              </Card>
            )}

            {backends.map(backend => (
              <Card 
                key={backend.id} 
                className={`p-4 ${defaultBackendId === backend.id ? 'ring-2 ring-primary' : ''}`}
                data-testid={`backend-card-${backend.id}`}
              >
                {editingBackend?.id === backend.id ? (
                  <div className="space-y-4">
                    <div className="grid gap-4">
                      <div className="grid gap-2">
                        <Label>Name</Label>
                        <Input
                          value={editingBackend.name}
                          onChange={e => setEditingBackend(prev => prev ? { ...prev, name: e.target.value } : null)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Base URL</Label>
                        <Input
                          value={editingBackend.baseUrl}
                          onChange={e => setEditingBackend(prev => prev ? { ...prev, baseUrl: e.target.value } : null)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Authentication</Label>
                        <Select
                          value={editingBackend.authType}
                          onValueChange={v => setEditingBackend(prev => prev ? { ...prev, authType: v as AuthType } : null)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            <SelectItem value="basic">Basic Auth</SelectItem>
                            <SelectItem value="bearer">Bearer Token</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {editingBackend.authType === "basic" && vaultStatus.unlocked && (
                        <div className="grid grid-cols-2 gap-4">
                          <div className="grid gap-2">
                            <Label>Username</Label>
                            <Input
                              placeholder="Leave blank to keep existing"
                              value={credentialInputs[backend.id]?.username || ""}
                              onChange={e => setCredentialInputs(prev => ({
                                ...prev,
                                [backend.id]: { ...prev[backend.id], username: e.target.value }
                              }))}
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label>Password</Label>
                            <Input
                              type="password"
                              placeholder="Leave blank to keep existing"
                              value={credentialInputs[backend.id]?.password || ""}
                              onChange={e => setCredentialInputs(prev => ({
                                ...prev,
                                [backend.id]: { ...prev[backend.id], password: e.target.value }
                              }))}
                            />
                          </div>
                        </div>
                      )}

                      {editingBackend.authType === "bearer" && vaultStatus.unlocked && (
                        <div className="grid gap-2">
                          <Label>Token</Label>
                          <Input
                            type="password"
                            placeholder="Leave blank to keep existing"
                            value={credentialInputs[backend.id]?.token || ""}
                            onChange={e => setCredentialInputs(prev => ({
                              ...prev,
                              [backend.id]: { ...prev[backend.id], token: e.target.value }
                            }))}
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => updateBackend(editingBackend)}>
                        <Check className="w-4 h-4 mr-2" />
                        Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingBackend(null)}>
                        <X className="w-4 h-4 mr-2" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">{backend.name}</h4>
                          {defaultBackendId === backend.id && (
                            <Badge variant="secondary">Default</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{backend.baseUrl}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Auth: {backend.authType === "none" ? "None" : backend.authType === "basic" ? "Basic Auth" : "Bearer Token"}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button 
                          size="icon" 
                          variant="ghost"
                          onClick={() => setEditingBackend(backend)}
                          data-testid={`button-edit-backend-${backend.id}`}
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost"
                          onClick={() => deleteBackend(backend.id)}
                          data-testid={`button-delete-backend-${backend.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    {backendModels[backend.id] && backendModels[backend.id].length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {backendModels[backend.id].slice(0, 5).map(model => (
                          <Badge key={model} variant="outline" className="text-xs">
                            {model}
                          </Badge>
                        ))}
                        {backendModels[backend.id].length > 5 && (
                          <Badge variant="outline" className="text-xs">
                            +{backendModels[backend.id].length - 5} more
                          </Badge>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => testBackend(backend)}
                        disabled={testingBackendId === backend.id}
                        data-testid={`button-test-backend-${backend.id}`}
                      >
                        {testingBackendId === backend.id ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : backendModels[backend.id] ? (
                          <CheckCircle className="w-4 h-4 mr-2 text-green-500" />
                        ) : (
                          <Cpu className="w-4 h-4 mr-2" />
                        )}
                        Test Connection
                      </Button>
                      {defaultBackendId !== backend.id && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDefaultBackend(backend.id)}
                          data-testid={`button-set-default-${backend.id}`}
                        >
                          Set as Default
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="roles" className="space-y-4">
          <div>
            <h3 className="text-lg font-medium mb-2">Agent Role Configuration</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Configure which backend and model each agent role uses for LLM calls.
            </p>
          </div>

          {backends.length === 0 ? (
            <Card className="p-6 text-center text-muted-foreground">
              <Server className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No backends configured</p>
              <p className="text-sm">Add an LLM backend in the Backends tab first</p>
            </Card>
          ) : (
            <div className="space-y-4">
              {AGENT_ROLES.map(role => {
                const config = roles[role] || {
                  backendId: defaultBackendId || "",
                  model: "",
                  temperature: 0.7,
                  numCtx: 4096,
                };
                const selectedBackend = backends.find(b => b.id === config.backendId);
                const availableModels = getAvailableModels(config.backendId);

                return (
                  <Card key={role} className="p-4" data-testid={`role-card-${role}`}>
                    <div className="space-y-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-medium flex items-center gap-2">
                            <Bot className="w-4 h-4" />
                            {role}
                          </h4>
                          <p className="text-sm text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label className="flex items-center gap-1">
                            <Server className="w-3 h-3" />
                            Backend
                          </Label>
                          <Select
                            value={config.backendId || ""}
                            onValueChange={v => updateRoleConfig(role, { backendId: v })}
                          >
                            <SelectTrigger data-testid={`select-backend-${role}`}>
                              <SelectValue placeholder="Select backend" />
                            </SelectTrigger>
                            <SelectContent>
                              {backends.map(b => (
                                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="grid gap-2">
                          <Label className="flex items-center gap-1">
                            <Cpu className="w-3 h-3" />
                            Model
                          </Label>
                          {availableModels.length > 0 ? (
                            <Select
                              value={config.model || ""}
                              onValueChange={v => updateRoleConfig(role, { model: v })}
                            >
                              <SelectTrigger data-testid={`select-model-${role}`}>
                                <SelectValue placeholder="Select model" />
                              </SelectTrigger>
                              <SelectContent>
                                {availableModels.map(m => (
                                  <SelectItem key={m} value={m}>{m}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              placeholder="e.g. codellama"
                              value={config.model || ""}
                              onChange={e => updateRoleConfig(role, { model: e.target.value })}
                              data-testid={`input-model-${role}`}
                            />
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label className="flex items-center justify-between">
                            <span className="flex items-center gap-1">
                              <Thermometer className="w-3 h-3" />
                              Temperature
                            </span>
                            <span className="text-muted-foreground">{config.temperature.toFixed(1)}</span>
                          </Label>
                          <Slider
                            value={[config.temperature]}
                            min={0}
                            max={2}
                            step={0.1}
                            onValueChange={([v]) => updateRoleConfig(role, { temperature: v })}
                            data-testid={`slider-temperature-${role}`}
                          />
                        </div>

                        <div className="grid gap-2">
                          <Label className="flex items-center justify-between">
                            <span className="flex items-center gap-1">
                              <Hash className="w-3 h-3" />
                              Context Length
                            </span>
                            <span className="text-muted-foreground">{config.numCtx.toLocaleString()}</span>
                          </Label>
                          <Select
                            value={config.numCtx.toString()}
                            onValueChange={v => updateRoleConfig(role, { numCtx: parseInt(v) })}
                          >
                            <SelectTrigger data-testid={`select-ctx-${role}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="2048">2,048</SelectItem>
                              <SelectItem value="4096">4,096</SelectItem>
                              <SelectItem value="8192">8,192</SelectItem>
                              <SelectItem value="16384">16,384</SelectItem>
                              <SelectItem value="32768">32,768</SelectItem>
                              <SelectItem value="65536">65,536</SelectItem>
                              <SelectItem value="131072">131,072</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
