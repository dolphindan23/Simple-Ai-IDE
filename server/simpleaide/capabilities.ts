import * as fs from "fs";
import * as path from "path";

export interface TemplateApplied {
  id: string;
  version: string;
  appliedAt: string;
}

export interface IntegrationStatus {
  status: "not_configured" | "configured" | "active";
  mode?: "test" | "live";
  webhookPath?: string;
  lastVerified?: string;
}

export interface ServiceStatus {
  enabled: boolean;
  via?: "docker-compose" | "native" | "external";
  port?: number;
}

export interface Capabilities {
  schemaVersion: number;
  templatesApplied: TemplateApplied[];
  integrations: Record<string, IntegrationStatus>;
  services: Record<string, ServiceStatus>;
  notes: Record<string, string>;
}

const DEFAULT_CAPABILITIES: Capabilities = {
  schemaVersion: 1,
  templatesApplied: [],
  integrations: {},
  services: {},
  notes: {}
};

const CAPABILITIES_FILENAME = "capabilities.json";
const SIMPLEAIDE_DIR = ".simpleaide";

function validateProjectRoot(projectRoot: string): string {
  const resolved = path.resolve(projectRoot);
  if (!resolved.startsWith(path.resolve(process.cwd()))) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

function getCapabilitiesPath(projectRoot: string): string {
  const resolved = validateProjectRoot(projectRoot);
  return path.join(resolved, SIMPLEAIDE_DIR, CAPABILITIES_FILENAME);
}

export function readCapabilities(projectRoot: string): Capabilities {
  try {
    const capPath = getCapabilitiesPath(projectRoot);
    if (!fs.existsSync(capPath)) {
      return { ...DEFAULT_CAPABILITIES };
    }
    const content = fs.readFileSync(capPath, "utf-8");
    const parsed = JSON.parse(content);
    return {
      schemaVersion: parsed.schemaVersion ?? 1,
      templatesApplied: parsed.templatesApplied ?? [],
      integrations: parsed.integrations ?? {},
      services: parsed.services ?? {},
      notes: parsed.notes ?? {}
    };
  } catch (error) {
    return { ...DEFAULT_CAPABILITIES };
  }
}

export function writeCapabilities(projectRoot: string, capabilities: Capabilities): void {
  const resolved = validateProjectRoot(projectRoot);
  const simpleaideDir = path.join(resolved, SIMPLEAIDE_DIR);
  const capPath = path.join(simpleaideDir, CAPABILITIES_FILENAME);
  
  if (!fs.existsSync(simpleaideDir)) {
    fs.mkdirSync(simpleaideDir, { recursive: true });
  }
  
  const tempPath = capPath + ".tmp." + Date.now();
  const content = JSON.stringify(capabilities, null, 2);
  
  fs.writeFileSync(tempPath, content, "utf-8");
  fs.renameSync(tempPath, capPath);
}

export function mergeAppliedTemplate(
  capabilities: Capabilities,
  templateMeta: {
    id: string;
    version: string;
    capabilitiesPatch?: {
      integrations?: Record<string, IntegrationStatus>;
      services?: Record<string, ServiceStatus>;
      notes?: Record<string, string>;
    };
  }
): Capabilities {
  const existingIndex = capabilities.templatesApplied.findIndex(
    t => t.id === templateMeta.id
  );
  
  const templateEntry: TemplateApplied = {
    id: templateMeta.id,
    version: templateMeta.version,
    appliedAt: new Date().toISOString()
  };
  
  const updatedTemplates = [...capabilities.templatesApplied];
  if (existingIndex >= 0) {
    updatedTemplates[existingIndex] = templateEntry;
  } else {
    updatedTemplates.push(templateEntry);
  }
  
  const patch = templateMeta.capabilitiesPatch ?? {};
  
  return {
    schemaVersion: capabilities.schemaVersion,
    templatesApplied: updatedTemplates,
    integrations: {
      ...capabilities.integrations,
      ...(patch.integrations ?? {})
    },
    services: {
      ...capabilities.services,
      ...(patch.services ?? {})
    },
    notes: {
      ...capabilities.notes,
      ...(patch.notes ?? {})
    }
  };
}

export function removeAppliedTemplate(
  capabilities: Capabilities,
  templateId: string
): Capabilities {
  return {
    ...capabilities,
    templatesApplied: capabilities.templatesApplied.filter(t => t.id !== templateId)
  };
}

export function hasTemplate(capabilities: Capabilities, templateId: string): boolean {
  return capabilities.templatesApplied.some(t => t.id === templateId);
}

export function getIntegrationStatus(
  capabilities: Capabilities,
  integrationId: string
): IntegrationStatus | undefined {
  return capabilities.integrations[integrationId];
}

export function updateIntegrationStatus(
  capabilities: Capabilities,
  integrationId: string,
  status: IntegrationStatus
): Capabilities {
  return {
    ...capabilities,
    integrations: {
      ...capabilities.integrations,
      [integrationId]: status
    }
  };
}
