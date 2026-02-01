import { listTemplates, loadTemplate, validateTemplate, resolveTemplateGraph } from "../templates/engine";
import { applyTemplateInCapsule } from "../templates/apply";
import { readCapabilities } from "../capabilities";
import { logToolCall } from "../db";

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface ToolContext {
  runId: string;
  projectId: string;
  projectPath: string;
  approvalToken?: string;
}

export async function handleTemplatesList(
  _input: Record<string, any>,
  context: ToolContext
): Promise<ToolResult> {
  const startTime = Date.now();
  
  try {
    const templates = listTemplates();
    
    logToolCall({
      run_id: context.runId,
      tool_name: "templates.list",
      input: JSON.stringify({}),
      output: JSON.stringify({ count: templates.length }),
      success: 1,
    });
    
    return {
      success: true,
      data: { templates },
    };
  } catch (error: any) {
    logToolCall({
      run_id: context.runId,
      tool_name: "templates.list",
      input: JSON.stringify({}),
      output: "",
      success: 0,
      error_message: error.message,
    });
    
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function handleTemplatesGet(
  input: { templateId: string },
  context: ToolContext
): Promise<ToolResult> {
  try {
    const { templateId } = input;
    
    if (!templateId) {
      return { success: false, error: "templateId is required" };
    }
    
    const template = loadTemplate(templateId);
    
    if (!template) {
      logToolCall({
        run_id: context.runId,
        tool_name: "templates.get",
        input: JSON.stringify({ templateId }),
        output: "",
        success: 0,
        error_message: "Template not found",
      });
      
      return { success: false, error: `Template "${templateId}" not found` };
    }
    
    const validation = validateTemplate(template);
    const chain = resolveTemplateGraph(templateId);
    
    logToolCall({
      run_id: context.runId,
      tool_name: "templates.get",
      input: JSON.stringify({ templateId }),
      output: JSON.stringify({ valid: validation.valid, chainLength: chain.length }),
      success: 1,
    });
    
    return {
      success: true,
      data: { 
        template, 
        validation,
        inheritanceChain: chain.map(t => t.id)
      },
    };
  } catch (error: any) {
    logToolCall({
      run_id: context.runId,
      tool_name: "templates.get",
      input: JSON.stringify(input),
      output: "",
      success: 0,
      error_message: error.message,
    });
    
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function handleTemplatesApply(
  input: { templateId: string; variables?: Record<string, string> },
  context: ToolContext
): Promise<ToolResult> {
  try {
    const { templateId, variables = {} } = input;
    
    if (!templateId) {
      return { success: false, error: "templateId is required" };
    }
    
    const result = await applyTemplateInCapsule({
      projectId: context.projectId,
      projectPath: context.projectPath,
      templateId,
      variables,
      runId: context.runId,
      approvalToken: context.approvalToken,
    });
    
    logToolCall({
      run_id: context.runId,
      tool_name: "templates.apply",
      input: JSON.stringify({ templateId, variables }),
      output: JSON.stringify({ 
        filesCreated: result.createdFiles.length,
        needsApproval: result.needsApproval
      }),
      success: result.needsApproval ? 0 : 1,
      error_message: result.needsApproval ? "Requires approval" : undefined,
    });
    
    return {
      success: !result.needsApproval,
      data: result,
    };
  } catch (error: any) {
    logToolCall({
      run_id: context.runId,
      tool_name: "templates.apply",
      input: JSON.stringify(input),
      output: "",
      success: 0,
      error_message: error.message,
    });
    
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function handleCapabilitiesRead(
  _input: Record<string, any>,
  context: ToolContext
): Promise<ToolResult> {
  try {
    const capabilities = readCapabilities(context.projectPath);
    
    logToolCall({
      run_id: context.runId,
      tool_name: "capabilities.read",
      input: JSON.stringify({}),
      output: JSON.stringify({ 
        hasIntegrations: Object.keys(capabilities.integrations || {}).length,
        templatesApplied: (capabilities.templatesApplied || []).length
      }),
      success: 1,
    });
    
    return {
      success: true,
      data: capabilities,
    };
  } catch (error: any) {
    logToolCall({
      run_id: context.runId,
      tool_name: "capabilities.read",
      input: JSON.stringify({}),
      output: "",
      success: 0,
      error_message: error.message,
    });
    
    return {
      success: false,
      error: error.message,
    };
  }
}

export const templateToolDefinitions = [
  {
    name: "templates.list",
    description: "List all available project templates in the catalog",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "templates.get",
    description: "Get details about a specific template including its variables, files it creates, and required secrets",
    parameters: {
      type: "object",
      properties: {
        templateId: {
          type: "string",
          description: "The unique identifier of the template (e.g., 'base-node', 'stripe-payments')",
        },
      },
      required: ["templateId"],
    },
  },
  {
    name: "templates.apply",
    description: "Apply a template to the current project. Templates can create files, update capabilities, and configure integrations. Some files may require approval if they touch immutable paths.",
    parameters: {
      type: "object",
      properties: {
        templateId: {
          type: "string",
          description: "The unique identifier of the template to apply",
        },
        variables: {
          type: "object",
          description: "Key-value pairs of variable values to customize the template. Check template.get to see available variables and their defaults.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["templateId"],
    },
  },
  {
    name: "capabilities.read",
    description: "Read the project's capabilities manifest showing applied templates, integrations, and services",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

export async function dispatchTemplateTool(
  toolName: string,
  input: Record<string, any>,
  context: ToolContext
): Promise<ToolResult> {
  switch (toolName) {
    case "templates.list":
      return handleTemplatesList(input, context);
    case "templates.get":
      return handleTemplatesGet(input as { templateId: string }, context);
    case "templates.apply":
      return handleTemplatesApply(
        input as { templateId: string; variables?: Record<string, string> },
        context
      );
    case "capabilities.read":
      return handleCapabilitiesRead(input, context);
    default:
      return {
        success: false,
        error: `Unknown template tool: ${toolName}`,
      };
  }
}
