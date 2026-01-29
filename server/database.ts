import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";

const PROJECT_ROOT = path.resolve(process.cwd());
const DB_DIR = path.join(PROJECT_ROOT, ".simpleaide", "databases");

export interface DatabaseInfo {
  name: string;
  type: "sqlite" | "postgres";
  path?: string;
  connectionString?: string;
}

export interface TableInfo {
  name: string;
  rowCount: number;
  hasFK: boolean;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  affectedRows?: number;
}

function ensureDbDir() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
}

function findSqliteFiles(): string[] {
  ensureDbDir();
  const files: string[] = [];
  
  function scanDir(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.name.endsWith(".db") || entry.name.endsWith(".sqlite") || entry.name.endsWith(".sqlite3")) {
          files.push(fullPath);
        }
      }
    } catch (e) {
      // ignore permission errors
    }
  }
  
  scanDir(PROJECT_ROOT);
  return files;
}

const dbConnections = new Map<string, Database.Database>();

function getDb(dbPath: string): Database.Database {
  if (dbConnections.has(dbPath)) {
    return dbConnections.get(dbPath)!;
  }
  
  const db = new Database(dbPath);
  dbConnections.set(dbPath, db);
  return db;
}

export function listDatabases(): DatabaseInfo[] {
  const databases: DatabaseInfo[] = [];
  
  const sqliteFiles = findSqliteFiles();
  for (const filePath of sqliteFiles) {
    const relativePath = path.relative(PROJECT_ROOT, filePath);
    databases.push({
      name: relativePath,
      type: "sqlite",
      path: filePath,
    });
  }
  
  return databases;
}

export function createSqliteDatabase(name: string): DatabaseInfo {
  ensureDbDir();
  const dbPath = path.join(DB_DIR, name.endsWith(".db") ? name : `${name}.db`);
  
  const db = new Database(dbPath);
  db.close();
  
  const relativePath = path.relative(PROJECT_ROOT, dbPath);
  return {
    name: relativePath,
    type: "sqlite",
    path: dbPath,
  };
}

export function getTables(dbPath: string): TableInfo[] {
  const db = getDb(dbPath);
  
  const tables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as { name: string }[];
  
  return tables.map(t => {
    const countResult = db.prepare(`SELECT COUNT(*) as count FROM "${t.name}"`).get() as { count: number };
    
    const fkInfo = db.prepare(`PRAGMA foreign_key_list("${t.name}")`).all();
    
    return {
      name: t.name,
      rowCount: countResult.count,
      hasFK: fkInfo.length > 0,
    };
  });
}

export function getTableSchema(dbPath: string, tableName: string): ColumnInfo[] {
  const db = getDb(dbPath);
  
  const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>;
  
  return columns.map(col => ({
    name: col.name,
    type: col.type,
    nullable: col.notnull === 0,
    primaryKey: col.pk > 0,
    defaultValue: col.dflt_value,
  }));
}

export function getRows(
  dbPath: string, 
  tableName: string, 
  options: { limit?: number; offset?: number; orderBy?: string; orderDir?: "asc" | "desc" } = {}
): QueryResult {
  const db = getDb(dbPath);
  const { limit = 100, offset = 0, orderBy, orderDir = "asc" } = options;
  
  let query = `SELECT * FROM "${tableName}"`;
  if (orderBy) {
    query += ` ORDER BY "${orderBy}" ${orderDir.toUpperCase()}`;
  }
  query += ` LIMIT ? OFFSET ?`;
  
  const rows = db.prepare(query).all(limit, offset) as Record<string, unknown>[];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  
  const countResult = db.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get() as { count: number };
  
  return {
    columns,
    rows,
    rowCount: countResult.count,
  };
}

export function insertRow(dbPath: string, tableName: string, data: Record<string, unknown>): QueryResult {
  const db = getDb(dbPath);
  
  const columns = Object.keys(data);
  const values = Object.values(data);
  const placeholders = columns.map(() => "?").join(", ");
  
  const query = `INSERT INTO "${tableName}" (${columns.map(c => `"${c}"`).join(", ")}) VALUES (${placeholders})`;
  const result = db.prepare(query).run(...values);
  
  return {
    columns: [],
    rows: [],
    rowCount: 0,
    affectedRows: result.changes,
  };
}

export function updateRow(
  dbPath: string, 
  tableName: string, 
  pkColumn: string, 
  pkValue: unknown, 
  data: Record<string, unknown>
): QueryResult {
  const db = getDb(dbPath);
  
  const setClauses = Object.keys(data).map(col => `"${col}" = ?`).join(", ");
  const values = [...Object.values(data), pkValue];
  
  const query = `UPDATE "${tableName}" SET ${setClauses} WHERE "${pkColumn}" = ?`;
  const result = db.prepare(query).run(...values);
  
  return {
    columns: [],
    rows: [],
    rowCount: 0,
    affectedRows: result.changes,
  };
}

export function deleteRow(dbPath: string, tableName: string, pkColumn: string, pkValue: unknown): QueryResult {
  const db = getDb(dbPath);
  
  const query = `DELETE FROM "${tableName}" WHERE "${pkColumn}" = ?`;
  const result = db.prepare(query).run(pkValue);
  
  return {
    columns: [],
    rows: [],
    rowCount: 0,
    affectedRows: result.changes,
  };
}

export function executeQuery(dbPath: string, sql: string): QueryResult {
  const db = getDb(dbPath);
  
  const trimmedSql = sql.trim().toLowerCase();
  const isSelect = trimmedSql.startsWith("select") || 
                   trimmedSql.startsWith("pragma") ||
                   trimmedSql.startsWith("explain");
  
  if (isSelect) {
    const rows = db.prepare(sql).all() as Record<string, unknown>[];
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    
    return {
      columns,
      rows,
      rowCount: rows.length,
    };
  } else {
    const result = db.prepare(sql).run();
    
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      affectedRows: result.changes,
    };
  }
}

export function closeAllConnections() {
  dbConnections.forEach((db) => {
    try {
      db.close();
    } catch (e) {
      // ignore
    }
  });
  dbConnections.clear();
}
