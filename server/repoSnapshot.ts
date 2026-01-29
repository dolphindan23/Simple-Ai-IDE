import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export interface FileSnapshot {
  path: string;
  exists: boolean;
  size?: number;
  hash?: string;
  preview?: string;
  lineCount?: number;
}

export interface RepoSnapshot {
  repoRoot: string;
  timestamp: string;
  files: FileSnapshot[];
  tree: string;
}

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".simpleaide",
  "__pycache__",
  ".venv",
  "venv",
  "dist",
  "build",
  ".next",
  ".cache",
]);

const IGNORE_FILES = new Set([
  ".DS_Store",
  "Thumbs.db",
  ".env",
  ".env.local",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".pyw",
  ".json", ".yaml", ".yml", ".toml",
  ".md", ".txt", ".rst",
  ".html", ".css", ".scss", ".less",
  ".sql", ".sh", ".bash",
  ".go", ".rs", ".java", ".kt", ".swift",
  ".c", ".cpp", ".h", ".hpp",
  ".rb", ".php", ".pl",
  ".xml", ".svg",
  ".gitignore", ".env.example",
  ".eslintrc", ".prettierrc",
]);

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath);
  return TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(basename);
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function getFilePreview(content: string, maxLines: number = 50): string {
  const lines = content.split("\n");
  if (lines.length <= maxLines) {
    return content;
  }
  return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} more lines)`;
}

function buildTree(dir: string, prefix: string = "", depth: number = 0, maxDepth: number = 5): string[] {
  if (depth > maxDepth) return [`${prefix}...`];
  
  const entries: string[] = [];
  
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    const filtered = items.filter(item => {
      if (item.isDirectory() && IGNORE_DIRS.has(item.name)) return false;
      if (item.isFile() && IGNORE_FILES.has(item.name)) return false;
      return true;
    });
    
    filtered.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });
    
    filtered.forEach((item, index) => {
      const isLast = index === filtered.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const nextPrefix = prefix + (isLast ? "    " : "│   ");
      
      if (item.isDirectory()) {
        entries.push(`${prefix}${connector}${item.name}/`);
        const subEntries = buildTree(path.join(dir, item.name), nextPrefix, depth + 1, maxDepth);
        entries.push(...subEntries);
      } else {
        entries.push(`${prefix}${connector}${item.name}`);
      }
    });
  } catch {
  }
  
  return entries;
}

export function captureFileSnapshot(repoRoot: string, filePath: string): FileSnapshot {
  const absolutePath = path.isAbsolute(filePath) 
    ? filePath 
    : path.join(repoRoot, filePath);
  
  const relativePath = path.relative(repoRoot, absolutePath);
  
  if (!fs.existsSync(absolutePath)) {
    return { path: relativePath, exists: false };
  }
  
  try {
    const stats = fs.statSync(absolutePath);
    
    if (!stats.isFile()) {
      return { path: relativePath, exists: false };
    }
    
    const snapshot: FileSnapshot = {
      path: relativePath,
      exists: true,
      size: stats.size,
    };
    
    if (isTextFile(absolutePath) && stats.size < 500 * 1024) {
      const content = fs.readFileSync(absolutePath, "utf-8");
      snapshot.hash = hashContent(content);
      snapshot.lineCount = content.split("\n").length;
      snapshot.preview = getFilePreview(content);
    }
    
    return snapshot;
  } catch {
    return { path: relativePath, exists: false };
  }
}

export function captureRepoSnapshot(repoRoot: string, targetFiles?: string[]): RepoSnapshot {
  const absoluteRoot = path.resolve(repoRoot);
  
  const tree = buildTree(absoluteRoot);
  
  const files: FileSnapshot[] = [];
  
  if (targetFiles && targetFiles.length > 0) {
    for (const file of targetFiles) {
      files.push(captureFileSnapshot(absoluteRoot, file));
    }
  }
  
  return {
    repoRoot: absoluteRoot,
    timestamp: new Date().toISOString(),
    files,
    tree: tree.join("\n"),
  };
}

export function formatSnapshotForPrompt(snapshot: RepoSnapshot): string {
  const parts: string[] = [];
  
  parts.push("=== REPOSITORY SNAPSHOT ===");
  parts.push(`Repo Root: ${snapshot.repoRoot}`);
  parts.push(`Captured: ${snapshot.timestamp}`);
  parts.push("");
  
  parts.push("=== FILE TREE ===");
  parts.push(snapshot.tree);
  parts.push("");
  
  if (snapshot.files.length > 0) {
    parts.push("=== TARGET FILES ===");
    for (const file of snapshot.files) {
      parts.push(`\n--- ${file.path} ---`);
      if (!file.exists) {
        parts.push("(NEW FILE - does not exist yet)");
      } else {
        parts.push(`Size: ${file.size} bytes | Lines: ${file.lineCount} | Hash: ${file.hash}`);
        if (file.preview) {
          parts.push("```");
          parts.push(file.preview);
          parts.push("```");
        }
      }
    }
  }
  
  return parts.join("\n");
}

export function extractTargetFilesFromGoal(goal: string, repoRoot: string): string[] {
  const filePatterns = [
    /(?:modify|edit|update|change|fix|add to|create)\s+[`"']?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`"']?/gi,
    /(?:in|file)\s+[`"']?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`"']?/gi,
    /[`"']([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`"']/g,
  ];
  
  const files = new Set<string>();
  
  for (const pattern of filePatterns) {
    let match;
    while ((match = pattern.exec(goal)) !== null) {
      const file = match[1];
      if (file && !file.includes("..") && !path.isAbsolute(file)) {
        files.add(file);
      }
    }
  }
  
  return Array.from(files);
}
