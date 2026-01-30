export type GitProvider = "github" | "gitlab" | "bitbucket" | "generic";

export interface ValidatedUrl {
  sanitizedUrl: string;
  provider: GitProvider;
  owner?: string;
  repo?: string;
}

const BLOCKED_PATTERNS = [
  /^file:\/\//i,
  /^\//, 
  /^\.\.?\//,
  /^[a-z]:\\/i,
  /ProxyCommand/i,
  /^localhost/i,
  /^127\.\d+\.\d+\.\d+/,
  /^192\.168\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
];

const HTTPS_WITH_CREDS = /^https?:\/\/[^@]+@/i;

export function sanitizeRemoteUrl(url: string): string {
  const trimmed = url.trim();
  
  if (HTTPS_WITH_CREDS.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      parsed.username = "";
      parsed.password = "";
      return parsed.toString();
    } catch {
      return trimmed.replace(/\/\/[^@]+@/, "//");
    }
  }
  
  return trimmed;
}

export function validateRemoteUrl(url: string): ValidatedUrl {
  const trimmed = url.trim();
  
  if (!trimmed) {
    throw new Error("VALIDATION_FAILED: URL is required");
  }
  
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error(`VALIDATION_FAILED: URL pattern not allowed for security reasons`);
    }
  }
  
  if (HTTPS_WITH_CREDS.test(trimmed)) {
    throw new Error("VALIDATION_FAILED: URL must not contain embedded credentials. Use auth_ref instead.");
  }
  
  const isHttps = /^https:\/\//i.test(trimmed);
  const isSsh = /^git@[\w.-]+:/i.test(trimmed) || /^ssh:\/\//i.test(trimmed);
  const isGitProtocol = /^git:\/\//i.test(trimmed);
  
  if (!isHttps && !isSsh && !isGitProtocol) {
    throw new Error("VALIDATION_FAILED: URL must use https://, git://, or SSH format (git@host:path)");
  }
  
  const provider = detectProvider(trimmed);
  const { owner, repo } = extractOwnerRepo(trimmed, provider);
  
  return {
    sanitizedUrl: sanitizeRemoteUrl(trimmed),
    provider,
    owner,
    repo,
  };
}

export function detectProvider(url: string): GitProvider {
  const lower = url.toLowerCase();
  
  if (lower.includes("github.com") || lower.includes("github.")) {
    return "github";
  }
  if (lower.includes("gitlab.com") || lower.includes("gitlab.")) {
    return "gitlab";
  }
  if (lower.includes("bitbucket.org") || lower.includes("bitbucket.")) {
    return "bitbucket";
  }
  
  return "generic";
}

function extractOwnerRepo(url: string, provider: GitProvider): { owner?: string; repo?: string } {
  let match: RegExpMatchArray | null = null;
  
  if (provider === "github" || provider === "gitlab" || provider === "bitbucket") {
    match = url.match(/(?:github\.com|gitlab\.com|bitbucket\.org)[\/:]([^\/]+)\/([^\/\s]+?)(?:\.git)?$/i);
  }
  
  if (match) {
    return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
  }
  
  return {};
}

export function buildCloneUrl(sanitizedUrl: string, _authRef?: string): string {
  return sanitizedUrl;
}

export function isValidBranch(branch: string): boolean {
  if (!branch || branch.length > 255) return false;
  if (/^[-.]|\.\.|\s|[\x00-\x1f\x7f~^:?*\[\\]/.test(branch)) return false;
  if (branch.endsWith("/") || branch.endsWith(".lock")) return false;
  return true;
}
