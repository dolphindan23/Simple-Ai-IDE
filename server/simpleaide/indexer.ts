import * as fs from "fs";
import * as path from "path";
import { insertChunks, clearProjectIndex, updateIndexMeta, getIndexMeta as dbGetIndexMeta, IndexChunk } from "./db";

const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".css": "css",
  ".scss": "scss",
  ".html": "html",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".md": "markdown",
  ".sql": "sql",
  ".sh": "shell",
  ".bash": "shell"
};

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".simpleaide",
  "dist",
  "build",
  ".next",
  "__pycache__",
  "venv",
  ".venv",
  "target"
]);

const CHUNK_SIZE = 50;
const CHUNK_OVERLAP = 10;

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGE_MAP[ext] || "unknown";
}

function chunkFile(content: string, filePath: string, projectId: string): IndexChunk[] {
  const lines = content.split("\n");
  const language = detectLanguage(filePath);
  const chunks: IndexChunk[] = [];

  for (let i = 0; i < lines.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    const startLine = i + 1;
    const endLine = Math.min(i + CHUNK_SIZE, lines.length);
    const chunkLines = lines.slice(i, endLine);
    
    const chunkText = chunkLines.join("\n");
    if (chunkText.trim().length > 0) {
      chunks.push({
        project_id: projectId,
        file_path: filePath,
        chunk_text: chunkText,
        language,
        start_line: startLine,
        end_line: endLine
      });
    }
  }

  return chunks;
}

function walkDirectory(dir: string, baseDir: string): string[] {
  const files: string[] = [];
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);
      
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          files.push(...walkDirectory(fullPath, baseDir));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (LANGUAGE_MAP[ext]) {
          files.push(relativePath);
        }
      }
    }
  } catch (error) {
    console.error(`Error walking directory ${dir}:`, error);
  }
  
  return files;
}

export async function buildIndex(
  projectPath: string, 
  projectId: string
): Promise<{ fileCount: number; chunkCount: number }> {
  const resolvedPath = path.resolve(projectPath);
  
  clearProjectIndex(projectId);

  const files = walkDirectory(resolvedPath, resolvedPath);
  let totalChunks = 0;

  for (const filePath of files) {
    try {
      const fullPath = path.join(resolvedPath, filePath);
      const content = fs.readFileSync(fullPath, "utf-8");
      
      const chunks = chunkFile(content, filePath, projectId);
      if (chunks.length > 0) {
        insertChunks(chunks);
        totalChunks += chunks.length;
      }
    } catch (error) {
      console.error(`Error indexing file ${filePath}:`, error);
    }
  }

  updateIndexMeta(projectId, files.length, totalChunks);

  return { fileCount: files.length, chunkCount: totalChunks };
}

export function getIndexMeta(projectId: string) {
  return dbGetIndexMeta(projectId);
}

export function searchLexical(projectId: string, query: string, limit = 20) {
  const { searchChunks } = require("./db");
  return searchChunks(projectId, query, limit);
}

export async function incrementalUpdate(
  projectPath: string,
  projectId: string,
  changedFiles: string[]
): Promise<{ updated: number; chunks: number }> {
  const resolvedPath = path.resolve(projectPath);
  let totalChunks = 0;
  let updatedCount = 0;

  for (const filePath of changedFiles) {
    try {
      const fullPath = path.join(resolvedPath, filePath);
      
      if (!fs.existsSync(fullPath)) {
        continue;
      }

      const content = fs.readFileSync(fullPath, "utf-8");
      const chunks = chunkFile(content, filePath, projectId);
      
      if (chunks.length > 0) {
        insertChunks(chunks);
        totalChunks += chunks.length;
        updatedCount++;
      }
    } catch (error) {
      console.error(`Error updating index for ${filePath}:`, error);
    }
  }

  return { updated: updatedCount, chunks: totalChunks };
}
