import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.join(__dirname);

export interface TemplateVariable {
  default: string;
  description?: string;
}

export interface TemplateGuardrails {
  recommendedImmutable?: string[];
  ports?: number[];
  networkAllowlistDomains?: string[];
}

export interface TemplateCapabilitiesPatch {
  integrations?: Record<string, any>;
  services?: Record<string, any>;
  notes?: Record<string, string>;
}

export interface TemplateCreates {
  files: string[];
  endpoints?: string[];
}

export interface PostInstallStep {
  type: "shell" | "npm" | "pip";
  cmd: string;
}

export interface Template {
  id: string;
  name: string;
  version: string;
  description: string;
  tags: string[];
  extends: string[];
  variables: Record<string, TemplateVariable>;
  creates: TemplateCreates;
  requiresSecrets: string[];
  capabilitiesPatch: TemplateCapabilitiesPatch;
  postInstall: PostInstallStep[];
  guardrails: TemplateGuardrails;
}

export interface TemplateSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  tags: string[];
  extends: string[];
  requiresSecrets: string[];
}

export interface RenderedFile {
  relativePath: string;
  content: string;
}

export interface TemplateRegistry {
  schemaVersion: number;
  templates: { id: string; path: string }[];
}

function getRegistryPath(): string {
  return path.join(TEMPLATES_DIR, "registry.json");
}

function loadRegistry(): TemplateRegistry {
  const registryPath = getRegistryPath();
  if (!fs.existsSync(registryPath)) {
    return { schemaVersion: 1, templates: [] };
  }
  const content = fs.readFileSync(registryPath, "utf-8");
  return JSON.parse(content);
}

export function listTemplates(): TemplateSummary[] {
  const registry = loadRegistry();
  const summaries: TemplateSummary[] = [];

  for (const entry of registry.templates) {
    try {
      const template = loadTemplate(entry.id);
      summaries.push({
        id: template.id,
        name: template.name,
        version: template.version,
        description: template.description,
        tags: template.tags,
        extends: template.extends,
        requiresSecrets: template.requiresSecrets,
      });
    } catch (error) {
      console.error(`Failed to load template ${entry.id}:`, error);
    }
  }

  return summaries;
}

export function loadTemplate(templateId: string): Template {
  const registry = loadRegistry();
  const entry = registry.templates.find((t) => t.id === templateId);

  if (!entry) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const templatePath = path.join(TEMPLATES_DIR, entry.path);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template file not found: ${templatePath}`);
  }

  const content = fs.readFileSync(templatePath, "utf-8");
  const template = JSON.parse(content) as Template;

  template.extends = template.extends ?? [];
  template.variables = template.variables ?? {};
  template.requiresSecrets = template.requiresSecrets ?? [];
  template.capabilitiesPatch = template.capabilitiesPatch ?? {};
  template.postInstall = template.postInstall ?? [];
  template.guardrails = template.guardrails ?? {};

  return template;
}

export function resolveTemplateGraph(templateId: string): Template[] {
  const visited = new Set<string>();
  const result: Template[] = [];

  function resolve(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);

    const template = loadTemplate(id);

    for (const parentId of template.extends) {
      resolve(parentId);
    }

    result.push(template);
  }

  resolve(templateId);
  return result;
}

function renderString(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
    result = result.replace(pattern, value);
  }
  return result;
}

export function renderTemplateFiles(
  templateChain: Template[],
  userVariables: Record<string, string>
): RenderedFile[] {
  const allVariables: Record<string, string> = {};
  
  for (const template of templateChain) {
    for (const [key, varDef] of Object.entries(template.variables)) {
      allVariables[key] = varDef.default;
    }
  }
  
  Object.assign(allVariables, userVariables);

  const renderedFiles: RenderedFile[] = [];
  const seenPaths = new Set<string>();

  for (const template of templateChain) {
    const templateDir = path.join(TEMPLATES_DIR, template.id, "files");
    
    if (!fs.existsSync(templateDir)) {
      continue;
    }

    const filesToCreate = template.creates.files;

    for (const relPath of filesToCreate) {
      const sourcePath = path.join(templateDir, relPath);
      
      if (!fs.existsSync(sourcePath)) {
        continue;
      }

      const stat = fs.statSync(sourcePath);
      if (stat.isDirectory()) {
        continue;
      }

      const rawContent = fs.readFileSync(sourcePath, "utf-8");
      const renderedContent = renderString(rawContent, allVariables);
      const renderedPath = renderString(relPath, allVariables);

      if (seenPaths.has(renderedPath)) {
        const existingIndex = renderedFiles.findIndex((f) => f.relativePath === renderedPath);
        if (existingIndex >= 0) {
          renderedFiles[existingIndex] = { relativePath: renderedPath, content: renderedContent };
        }
      } else {
        seenPaths.add(renderedPath);
        renderedFiles.push({ relativePath: renderedPath, content: renderedContent });
      }
    }
  }

  return renderedFiles;
}

export function validateTemplate(template: Template): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!template.id) {
    errors.push("Template must have an id");
  }
  if (!template.name) {
    errors.push("Template must have a name");
  }
  if (!template.version) {
    errors.push("Template must have a version");
  }
  if (!template.creates || !template.creates.files) {
    errors.push("Template must specify files to create");
  }

  for (const parentId of template.extends) {
    try {
      loadTemplate(parentId);
    } catch {
      errors.push(`Parent template not found: ${parentId}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function getMergedCapabilitiesPatch(
  templateChain: Template[],
  variables: Record<string, string>
): TemplateCapabilitiesPatch {
  const merged: TemplateCapabilitiesPatch = {
    integrations: {},
    services: {},
    notes: {},
  };

  for (const template of templateChain) {
    const patch = template.capabilitiesPatch;
    
    if (patch.integrations) {
      for (const [key, value] of Object.entries(patch.integrations)) {
        const renderedValue = JSON.parse(renderString(JSON.stringify(value), variables));
        merged.integrations![key] = renderedValue;
      }
    }
    
    if (patch.services) {
      Object.assign(merged.services!, patch.services);
    }
    
    if (patch.notes) {
      Object.assign(merged.notes!, patch.notes);
    }
  }

  return merged;
}

export function getMergedRequiredSecrets(templateChain: Template[]): string[] {
  const secrets = new Set<string>();
  for (const template of templateChain) {
    for (const secret of template.requiresSecrets) {
      secrets.add(secret);
    }
  }
  return Array.from(secrets);
}

export function getMergedGuardrails(templateChain: Template[]): TemplateGuardrails {
  const merged: TemplateGuardrails = {
    recommendedImmutable: [],
    ports: [],
    networkAllowlistDomains: [],
  };

  for (const template of templateChain) {
    const gr = template.guardrails;
    if (gr.recommendedImmutable) {
      merged.recommendedImmutable!.push(...gr.recommendedImmutable);
    }
    if (gr.ports) {
      merged.ports!.push(...gr.ports);
    }
    if (gr.networkAllowlistDomains) {
      merged.networkAllowlistDomains!.push(...gr.networkAllowlistDomains);
    }
  }

  merged.recommendedImmutable = Array.from(new Set(merged.recommendedImmutable));
  merged.ports = Array.from(new Set(merged.ports));
  merged.networkAllowlistDomains = Array.from(new Set(merged.networkAllowlistDomains));

  return merged;
}

export function getMergedPostInstall(templateChain: Template[]): PostInstallStep[] {
  const steps: PostInstallStep[] = [];
  for (const template of templateChain) {
    steps.push(...template.postInstall);
  }
  return steps;
}
