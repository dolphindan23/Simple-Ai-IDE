import * as path from "path";
import * as crypto from "crypto";
import { capsuleProvider } from "../capsule";
import { createAgentRun, updateAgentRun, logToolCall } from "../db";
import { readCapabilities, writeCapabilities, mergeAppliedTemplate } from "../capabilities";
import {
  loadTemplate,
  resolveTemplateGraph,
  renderTemplateFiles,
  getMergedCapabilitiesPatch,
  getMergedRequiredSecrets,
  getMergedGuardrails,
  getMergedPostInstall,
  Template,
  RenderedFile,
  PostInstallStep,
} from "./engine";

export interface ApplyTemplateOptions {
  projectId: string;
  projectPath: string;
  templateId: string;
  variables?: Record<string, string>;
  runId?: string;
  approvalToken?: string;
}

export interface ApplyTemplateResult {
  runId: string;
  patchSummary: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  createdFiles: string[];
  requiresSecrets: string[];
  capabilitiesUpdated: boolean;
  needsApproval: boolean;
  approvalReasons: { type: string; paths?: string[]; details?: string }[];
  postInstallSteps: PostInstallStep[];
}

export async function applyTemplateInCapsule(
  options: ApplyTemplateOptions
): Promise<ApplyTemplateResult> {
  const { projectId, projectPath, templateId, variables = {}, approvalToken } = options;

  const templateChain = resolveTemplateGraph(templateId);
  const mainTemplate = templateChain[templateChain.length - 1];

  const runId = options.runId || `tpl_${crypto.randomUUID()}`;
  
  if (!options.runId) {
    createAgentRun({
      id: runId,
      project_id: projectId,
      status: "running",
      model_used: `template:${templateId}`,
      template_apply_json: JSON.stringify({
        templateId,
        variables,
        templatesApplied: templateChain.map((t) => t.id),
      }),
    });
  }

  const capsule = capsuleProvider.getOrCreateCapsule(runId, projectPath);

  const guardrails = getMergedGuardrails(templateChain);
  if (guardrails.recommendedImmutable && guardrails.recommendedImmutable.length > 0) {
    for (const pattern of guardrails.recommendedImmutable) {
      capsule.addImmutablePattern(pattern);
    }
  }

  const renderedFiles = renderTemplateFiles(templateChain, variables);
  const createdFiles: string[] = [];
  const approvalReasons: { type: string; paths?: string[]; details?: string }[] = [];
  let insertions = 0;

  for (const file of renderedFiles) {
    try {
      capsule.writeFile(file.relativePath, file.content, { approvalToken });
      createdFiles.push(file.relativePath);
      insertions += file.content.split("\n").length;

      logToolCall({
        run_id: runId,
        tool_name: "template.writeFile",
        input: JSON.stringify({ path: file.relativePath, size: file.content.length }),
        output: "success",
        success: 1,
      });
    } catch (error: any) {
      if (error.message.includes("immutable") || error.message.includes("approval")) {
        approvalReasons.push({
          type: "IMMUTABLE_PATH",
          paths: [file.relativePath],
          details: error.message,
        });
      } else if (error.message.includes("secret") || error.message.includes("SECRET")) {
        approvalReasons.push({
          type: "SECRET_DETECTED",
          paths: [file.relativePath],
          details: error.message,
        });
      } else {
        throw error;
      }

      logToolCall({
        run_id: runId,
        tool_name: "template.writeFile",
        input: JSON.stringify({ path: file.relativePath }),
        output: error.message,
        success: 0,
        error_message: error.message,
      });
    }
  }

  const capabilitiesPatch = getMergedCapabilitiesPatch(templateChain, variables);
  let capabilitiesUpdated = false;

  try {
    let existingCaps = readCapabilities(projectPath);
    
    for (const template of templateChain) {
      existingCaps = mergeAppliedTemplate(existingCaps, {
        id: template.id,
        version: template.version,
        capabilitiesPatch: {
          integrations: capabilitiesPatch.integrations,
          services: capabilitiesPatch.services,
          notes: capabilitiesPatch.notes,
        },
      });
    }

    const capabilitiesContent = JSON.stringify(existingCaps, null, 2);
    const capabilitiesPath = ".simpleaide/capabilities.json";
    
    capsule.writeFile(capabilitiesPath, capabilitiesContent, { approvalToken });
    createdFiles.push(capabilitiesPath);
    capabilitiesUpdated = true;

    logToolCall({
      run_id: runId,
      tool_name: "template.updateCapabilities",
      input: JSON.stringify({ templatesApplied: templateChain.map((t) => t.id) }),
      output: "success",
      success: 1,
    });
  } catch (error: any) {
    logToolCall({
      run_id: runId,
      tool_name: "template.updateCapabilities",
      input: JSON.stringify({ templateId }),
      output: error.message,
      success: 0,
      error_message: error.message,
    });
  }

  const requiresSecrets = getMergedRequiredSecrets(templateChain);
  const postInstallSteps = getMergedPostInstall(templateChain);

  const pendingWrites = capsule.getPendingWrites();
  const needsApproval = pendingWrites.length > 0 || approvalReasons.length > 0;

  if (needsApproval) {
    updateAgentRun(runId, { status: "needs_approval" });
  } else {
    updateAgentRun(runId, { status: "ready_to_apply" });
  }

  return {
    runId,
    patchSummary: {
      filesChanged: createdFiles.length,
      insertions,
      deletions: 0,
    },
    createdFiles,
    requiresSecrets,
    capabilitiesUpdated,
    needsApproval,
    approvalReasons,
    postInstallSteps,
  };
}

export function getTemplateApplyPreview(
  templateId: string,
  variables: Record<string, string>
): {
  files: RenderedFile[];
  requiresSecrets: string[];
  guardrails: ReturnType<typeof getMergedGuardrails>;
  postInstall: PostInstallStep[];
  templateChain: { id: string; name: string; version: string }[];
} {
  const templateChain = resolveTemplateGraph(templateId);
  const files = renderTemplateFiles(templateChain, variables);
  const requiresSecrets = getMergedRequiredSecrets(templateChain);
  const guardrails = getMergedGuardrails(templateChain);
  const postInstall = getMergedPostInstall(templateChain);

  return {
    files,
    requiresSecrets,
    guardrails,
    postInstall,
    templateChain: templateChain.map((t) => ({
      id: t.id,
      name: t.name,
      version: t.version,
    })),
  };
}
