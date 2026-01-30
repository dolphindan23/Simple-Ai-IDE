export type GitProvider = "github" | "gitlab" | "bitbucket" | "generic";

export interface ValidatedUrl {
  sanitizedUrl: string;
  provider: GitProvider;
  owner?: string;
  repo?: string;
}

const BLOCKED_URL_PATTERNS = [
  /^file:\/\//i,
  /^\//, 
  /^\.\.?\//,
  /^[a-z]:\\/i,
  /ProxyCommand/i,
];

const HTTPS_WITH_CREDS = /^https?:\/\/[^@]+@/i;

const BLOCKED_HOSTNAMES = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "::1",
];

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".local",
  ".internal",
  ".localhost",
  ".localdomain",
];

const ALLOWED_PROVIDER_HOSTS = [
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "dev.azure.com",
  "ssh.dev.azure.com",
  "codeberg.org",
  "gitea.com",
  "sr.ht",
  "git.sr.ht",
];

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 0) return true;
  
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.replace(/^\[|\]$/g, "").toLowerCase();
  
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80:")) return true;
  if (normalized === "::") return true;
  
  const ipv4MappedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4MappedMatch) {
    return isPrivateIPv4(ipv4MappedMatch[1]);
  }
  
  const ipv4CompatMatch = normalized.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4CompatMatch) {
    return isPrivateIPv4(ipv4CompatMatch[1]);
  }
  
  return false;
}

function extractHostname(url: string): string | null {
  const trimmed = url.trim();
  
  const sshMatch = trimmed.match(/^git@([^:]+):/);
  if (sshMatch) {
    return sshMatch[1].toLowerCase();
  }
  
  const sshUrlMatch = trimmed.match(/^ssh:\/\/(?:[^@]+@)?([^\/:\s]+)/i);
  if (sshUrlMatch) {
    return sshUrlMatch[1].toLowerCase();
  }
  
  try {
    const parsed = new URL(trimmed);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  
  if (BLOCKED_HOSTNAMES.includes(lower)) {
    return true;
  }
  
  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      return true;
    }
  }
  
  if (isPrivateIPv4(lower)) {
    return true;
  }
  
  if (lower.startsWith("[") || lower.includes(":")) {
    if (isPrivateIPv6(lower)) {
      return true;
    }
  }
  
  return false;
}

function isAllowedProviderHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  
  for (const allowed of ALLOWED_PROVIDER_HOSTS) {
    if (lower === allowed || lower.endsWith("." + allowed)) {
      return true;
    }
  }
  
  return false;
}

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
  
  for (const pattern of BLOCKED_URL_PATTERNS) {
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
  
  if (isGitProtocol) {
    throw new Error("VALIDATION_FAILED: git:// protocol is not allowed. Use https:// instead.");
  }
  
  if (!isHttps && !isSsh) {
    throw new Error("VALIDATION_FAILED: URL must use https:// or SSH format (git@host:path)");
  }
  
  const hostname = extractHostname(trimmed);
  if (!hostname) {
    throw new Error("VALIDATION_FAILED: Could not parse hostname from URL");
  }
  
  if (isBlockedHostname(hostname)) {
    throw new Error("VALIDATION_FAILED: Internal network addresses are not allowed");
  }
  
  if (!isAllowedProviderHost(hostname)) {
    throw new Error(`VALIDATION_FAILED: Host '${hostname}' is not in the allowed providers list. Supported: GitHub, GitLab, Bitbucket, Azure DevOps, Codeberg, Gitea, SourceHut`);
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
