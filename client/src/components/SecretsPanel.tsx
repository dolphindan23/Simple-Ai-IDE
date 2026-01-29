import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Shield, Lock, Unlock, Plus, Trash2, Eye, EyeOff, Key, Loader2, CheckCircle, XCircle, Zap, Puzzle } from "lucide-react";
import type { Settings as SettingsType } from "@shared/schema";

interface VaultStatus {
  exists: boolean;
  unlocked: boolean;
}

interface Secret {
  key: string;
  maskedValue: string;
}

export function SecretsPanel() {
  const { toast } = useToast();
  
  // Vault state
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>({ exists: false, unlocked: false });
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [masterPassword, setMasterPassword] = useState("");
  const [newSecretKey, setNewSecretKey] = useState("");
  const [newSecretValue, setNewSecretValue] = useState("");
  const [showNewSecretValue, setShowNewSecretValue] = useState(false);
  
  // Settings for integrations
  const [settings, setSettings] = useState<SettingsType | null>(null);
  
  // Integration test state
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});

  const { data: savedSettings } = useQuery<SettingsType>({
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
      if (data.unlocked) {
        fetchSecrets();
      }
    } catch (error) {
      console.error("Failed to fetch vault status:", error);
    }
  };

  const fetchSecrets = async () => {
    try {
      const res = await fetch("/api/secrets");
      if (res.ok) {
        const data = await res.json();
        setSecrets(data.secrets);
      }
    } catch (error) {
      console.error("Failed to fetch secrets:", error);
    }
  };

  const handleCreateVault = async () => {
    if (masterPassword.length < 8) {
      toast({ title: "Error", description: "Master password must be at least 8 characters", variant: "destructive" });
      return;
    }
    try {
      const res = await apiRequest("POST", "/api/secrets/create", { masterPassword });
      if (res.ok) {
        toast({ title: "Vault created", description: "Your secrets vault has been created and unlocked." });
        setMasterPassword("");
        await fetchVaultStatus();
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleUnlockVault = async () => {
    try {
      const res = await apiRequest("POST", "/api/secrets/unlock", { masterPassword });
      if (res.ok) {
        toast({ title: "Vault unlocked" });
        setMasterPassword("");
        await fetchVaultStatus();
        await fetchSecrets();
      }
    } catch (error: any) {
      toast({ title: "Error", description: "Invalid master password", variant: "destructive" });
    }
  };

  const handleLockVault = async () => {
    try {
      await apiRequest("POST", "/api/secrets/lock", {});
      setVaultStatus({ ...vaultStatus, unlocked: false });
      setSecrets([]);
      toast({ title: "Vault locked" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleAddSecret = async () => {
    if (!newSecretKey.trim() || !newSecretValue.trim()) {
      toast({ title: "Error", description: "Both key and value are required", variant: "destructive" });
      return;
    }
    try {
      const res = await apiRequest("PUT", `/api/secrets/${encodeURIComponent(newSecretKey)}`, { value: newSecretValue });
      if (res.ok) {
        toast({ title: "Secret saved", description: `Secret '${newSecretKey}' has been saved.` });
        setNewSecretKey("");
        setNewSecretValue("");
        await fetchSecrets();
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleDeleteSecret = async (key: string) => {
    try {
      const res = await apiRequest("DELETE", `/api/secrets/${encodeURIComponent(key)}`, {});
      if (res.ok) {
        toast({ title: "Secret deleted", description: `Secret '${key}' has been deleted.` });
        await fetchSecrets();
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const saveSettings = async (newSettings: SettingsType) => {
    try {
      await apiRequest("PUT", "/api/settings", newSettings);
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings saved" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleTestConnection = async (provider: string) => {
    if (provider === "kaggle" && !settings?.integrations.kaggle.username?.trim()) {
      toast({ title: "Missing username", description: "Enter your Kaggle username before testing", variant: "destructive" });
      return;
    }
    
    setTestingProvider(provider);
    setTestResults((prev) => {
      const updated = { ...prev };
      delete updated[provider];
      return updated;
    });
    
    try {
      const body: Record<string, string> = {};
      if (provider === "kaggle" && settings?.integrations.kaggle.username) {
        body.username = settings.integrations.kaggle.username;
      }
      
      const res = await apiRequest("POST", `/api/integrations/test/${provider}`, body);
      const data = await res.json();
      
      if (res.ok) {
        setTestResults((prev) => ({ ...prev, [provider]: { success: true, message: data.details || "Connected" } }));
        toast({ title: "Connection successful", description: data.message });
      } else {
        setTestResults((prev) => ({ ...prev, [provider]: { success: false, message: data.error } }));
        toast({ title: "Connection failed", description: data.error, variant: "destructive" });
      }
    } catch (error: any) {
      setTestResults((prev) => ({ ...prev, [provider]: { success: false, message: error.message } }));
      toast({ title: "Connection failed", description: error.message, variant: "destructive" });
    } finally {
      setTestingProvider(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm">Secrets & Integrations</span>
        </div>
        {vaultStatus.unlocked && (
          <Button variant="ghost" size="sm" onClick={handleLockVault} data-testid="button-lock-vault">
            <Lock className="w-4 h-4 mr-1" />
            Lock
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <Tabs defaultValue="vault" className="w-full">
            <TabsList className="grid w-full grid-cols-2" data-testid="secrets-tabs">
              <TabsTrigger value="vault" className="flex items-center gap-1" data-testid="tab-vault">
                <Shield className="w-4 h-4" />
                Vault
              </TabsTrigger>
              <TabsTrigger value="integrations" className="flex items-center gap-1" data-testid="tab-integrations">
                <Puzzle className="w-4 h-4" />
                APIs
              </TabsTrigger>
            </TabsList>

            <TabsContent value="vault" className="space-y-4 mt-4" data-testid="panel-vault">
              {!vaultStatus.exists ? (
                <div className="p-4 border rounded-md space-y-4">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-muted-foreground" />
                    <Label className="text-base font-medium">Create Vault</Label>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Create a new encrypted vault to store your API keys and secrets securely with AES-256 encryption.
                  </p>
                  <div className="space-y-2">
                    <Label>Master Password</Label>
                    <Input
                      type="password"
                      value={masterPassword}
                      onChange={(e) => setMasterPassword(e.target.value)}
                      placeholder="Enter master password (min 8 chars)"
                      data-testid="input-master-password"
                    />
                  </div>
                  <Button onClick={handleCreateVault} data-testid="button-create-vault">
                    <Lock className="w-4 h-4 mr-2" />
                    Create Vault
                  </Button>
                </div>
              ) : !vaultStatus.unlocked ? (
                <div className="p-4 border rounded-md space-y-4">
                  <div className="flex items-center gap-2">
                    <Lock className="w-5 h-5 text-yellow-500" />
                    <Label className="text-base font-medium">Vault Locked</Label>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Enter your master password to unlock the secrets vault.
                  </p>
                  <div className="space-y-2">
                    <Label>Master Password</Label>
                    <Input
                      type="password"
                      value={masterPassword}
                      onChange={(e) => setMasterPassword(e.target.value)}
                      placeholder="Enter master password"
                      data-testid="input-unlock-password"
                    />
                  </div>
                  <Button onClick={handleUnlockVault} data-testid="button-unlock-vault">
                    <Unlock className="w-4 h-4 mr-2" />
                    Unlock Vault
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 border rounded-md bg-muted/30">
                    <div className="flex items-center gap-2">
                      <Unlock className="w-5 h-5 text-green-500" />
                      <span className="font-medium text-sm">Vault Unlocked</span>
                    </div>
                  </div>

                  <div className="p-4 border rounded-md space-y-3">
                    <Label className="text-sm font-medium">Add New Secret</Label>
                    <div className="space-y-2">
                      <Input
                        value={newSecretKey}
                        onChange={(e) => setNewSecretKey(e.target.value)}
                        placeholder="Key (e.g. KAGGLE_API_KEY)"
                        data-testid="input-new-secret-key"
                      />
                      <div className="relative">
                        <Input
                          type={showNewSecretValue ? "text" : "password"}
                          value={newSecretValue}
                          onChange={(e) => setNewSecretValue(e.target.value)}
                          placeholder="Value"
                          data-testid="input-new-secret-value"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full"
                          onClick={() => setShowNewSecretValue(!showNewSecretValue)}
                        >
                          {showNewSecretValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>
                    <Button size="sm" onClick={handleAddSecret} data-testid="button-add-secret">
                      <Plus className="w-4 h-4 mr-1" />
                      Add Secret
                    </Button>
                  </div>

                  {secrets.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Stored Secrets</Label>
                      <div className="space-y-1">
                        {secrets.map((secret) => (
                          <div
                            key={secret.key}
                            className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm"
                            data-testid={`secret-${secret.key}`}
                          >
                            <div className="flex items-center gap-2">
                              <Key className="w-3 h-3 text-muted-foreground" />
                              <span className="font-mono text-xs">{secret.key}</span>
                              <span className="text-muted-foreground text-xs">({secret.maskedValue})</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => handleDeleteSecret(secret.key)}
                              data-testid={`button-delete-${secret.key}`}
                            >
                              <Trash2 className="w-3 h-3 text-destructive" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="integrations" className="space-y-4 mt-4" data-testid="panel-integrations">
              {!settings ? (
                <div className="text-center text-muted-foreground py-8">Loading...</div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 border rounded-md space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm font-medium">Kaggle</Label>
                        <p className="text-xs text-muted-foreground">Access Kaggle datasets and competitions</p>
                      </div>
                      <Switch
                        checked={settings.integrations.kaggle.enabled}
                        onCheckedChange={(checked) => {
                          const newSettings = {
                            ...settings,
                            integrations: {
                              ...settings.integrations,
                              kaggle: { ...settings.integrations.kaggle, enabled: checked }
                            }
                          };
                          setSettings(newSettings);
                          saveSettings(newSettings);
                        }}
                        data-testid="switch-kaggle"
                      />
                    </div>
                    {settings.integrations.kaggle.enabled && (
                      <div className="space-y-2 pt-2">
                        <Input
                          value={settings.integrations.kaggle.username || ""}
                          onChange={(e) => {
                            const newSettings = {
                              ...settings,
                              integrations: {
                                ...settings.integrations,
                                kaggle: { ...settings.integrations.kaggle, username: e.target.value }
                              }
                            };
                            setSettings(newSettings);
                          }}
                          onBlur={() => saveSettings(settings)}
                          placeholder="Kaggle username"
                          data-testid="input-kaggle-username"
                        />
                        <p className="text-xs text-muted-foreground">Store KAGGLE_API_KEY in Vault tab</p>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleTestConnection("kaggle")}
                            disabled={testingProvider === "kaggle" || !vaultStatus.unlocked}
                            data-testid="button-test-kaggle"
                          >
                            {testingProvider === "kaggle" ? (
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            ) : (
                              <Zap className="w-3 h-3 mr-1" />
                            )}
                            Test
                          </Button>
                          {testResults.kaggle && (
                            <span className={`flex items-center gap-1 text-xs ${testResults.kaggle.success ? "text-green-500" : "text-red-500"}`}>
                              {testResults.kaggle.success ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                              {testResults.kaggle.message}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="p-4 border rounded-md space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm font-medium">HuggingFace</Label>
                        <p className="text-xs text-muted-foreground">Access HuggingFace models and datasets</p>
                      </div>
                      <Switch
                        checked={settings.integrations.huggingface.enabled}
                        onCheckedChange={(checked) => {
                          const newSettings = {
                            ...settings,
                            integrations: {
                              ...settings.integrations,
                              huggingface: { ...settings.integrations.huggingface, enabled: checked }
                            }
                          };
                          setSettings(newSettings);
                          saveSettings(newSettings);
                        }}
                        data-testid="switch-huggingface"
                      />
                    </div>
                    {settings.integrations.huggingface.enabled && (
                      <div className="space-y-2 pt-2">
                        <p className="text-xs text-muted-foreground">Store HUGGINGFACE_TOKEN in Vault tab</p>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleTestConnection("huggingface")}
                            disabled={testingProvider === "huggingface" || !vaultStatus.unlocked}
                            data-testid="button-test-huggingface"
                          >
                            {testingProvider === "huggingface" ? (
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            ) : (
                              <Zap className="w-3 h-3 mr-1" />
                            )}
                            Test
                          </Button>
                          {testResults.huggingface && (
                            <span className={`flex items-center gap-1 text-xs ${testResults.huggingface.success ? "text-green-500" : "text-red-500"}`}>
                              {testResults.huggingface.success ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                              {testResults.huggingface.message}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="p-4 border rounded-md space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm font-medium">NVIDIA NGC</Label>
                        <p className="text-xs text-muted-foreground">Access NVIDIA GPU Cloud resources</p>
                      </div>
                      <Switch
                        checked={settings.integrations.ngc.enabled}
                        onCheckedChange={(checked) => {
                          const newSettings = {
                            ...settings,
                            integrations: {
                              ...settings.integrations,
                              ngc: { ...settings.integrations.ngc, enabled: checked }
                            }
                          };
                          setSettings(newSettings);
                          saveSettings(newSettings);
                        }}
                        data-testid="switch-ngc"
                      />
                    </div>
                    {settings.integrations.ngc.enabled && (
                      <div className="space-y-2 pt-2">
                        <Input
                          value={settings.integrations.ngc.org || ""}
                          onChange={(e) => {
                            const newSettings = {
                              ...settings,
                              integrations: {
                                ...settings.integrations,
                                ngc: { ...settings.integrations.ngc, org: e.target.value }
                              }
                            };
                            setSettings(newSettings);
                          }}
                          onBlur={() => saveSettings(settings)}
                          placeholder="NGC Organization"
                          data-testid="input-ngc-org"
                        />
                        <p className="text-xs text-muted-foreground">Store NGC_API_KEY in Vault tab</p>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleTestConnection("ngc")}
                            disabled={testingProvider === "ngc" || !vaultStatus.unlocked}
                            data-testid="button-test-ngc"
                          >
                            {testingProvider === "ngc" ? (
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            ) : (
                              <Zap className="w-3 h-3 mr-1" />
                            )}
                            Test
                          </Button>
                          {testResults.ngc && (
                            <span className={`flex items-center gap-1 text-xs ${testResults.ngc.success ? "text-green-500" : "text-red-500"}`}>
                              {testResults.ngc.success ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                              {testResults.ngc.message}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
}
