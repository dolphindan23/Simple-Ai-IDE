import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { DATA_DIR, PROJECT_ROOT } from "./config/paths";

const DB_DIR = path.join(DATA_DIR, "databases");

const IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

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

function isValidPath(dbPath: string): boolean {
  const resolved = path.resolve(dbPath);
  
  if (!resolved.startsWith(DB_DIR + path.sep) && resolved !== DB_DIR) {
    return false;
  }
  
  if (!fs.existsSync(resolved)) {
    return false;
  }
  
  return true;
}

function validateIdentifier(name: string, type: string): void {
  if (!name || typeof name !== "string") {
    throw new Error(`${type} is required`);
  }
  if (!IDENTIFIER_REGEX.test(name)) {
    throw new Error(`Invalid ${type}: only alphanumeric characters and underscores allowed`);
  }
  if (name.length > 128) {
    throw new Error(`${type} is too long (max 128 characters)`);
  }
}

function findSqliteFiles(): string[] {
  ensureDbDir();
  const files: string[] = [];
  
  try {
    const entries = fs.readdirSync(DB_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(DB_DIR, entry.name);
      if (!entry.isDirectory() && 
          (entry.name.endsWith(".db") || entry.name.endsWith(".sqlite") || entry.name.endsWith(".sqlite3"))) {
        files.push(fullPath);
      }
    }
  } catch (e) {
    // ignore permission errors
  }
  
  return files;
}

const dbConnections = new Map<string, Database.Database>();

function getDb(dbPath: string): Database.Database {
  if (!isValidPath(dbPath)) {
    throw new Error("Access denied: database path is outside allowed directory");
  }
  
  if (dbConnections.has(dbPath)) {
    return dbConnections.get(dbPath)!;
  }
  
  const db = new Database(dbPath);
  dbConnections.set(dbPath, db);
  return db;
}

function getValidTables(db: Database.Database): Set<string> {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `).all() as { name: string }[];
  return new Set(tables.map(t => t.name));
}

function getValidColumns(db: Database.Database, tableName: string): Set<string> {
  const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{
    name: string;
  }>;
  return new Set(columns.map(c => c.name));
}

function validateTableName(db: Database.Database, tableName: string): void {
  validateIdentifier(tableName, "table name");
  const validTables = getValidTables(db);
  if (!validTables.has(tableName)) {
    throw new Error(`Table '${tableName}' does not exist`);
  }
}

function validateColumnName(db: Database.Database, tableName: string, columnName: string): void {
  validateIdentifier(columnName, "column name");
  const validColumns = getValidColumns(db, tableName);
  if (!validColumns.has(columnName)) {
    throw new Error(`Column '${columnName}' does not exist in table '${tableName}'`);
  }
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
  
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safeName || safeName.startsWith(".") || safeName.includes("..")) {
    throw new Error("Invalid database name");
  }
  
  const dbPath = path.join(DB_DIR, safeName.endsWith(".db") ? safeName : `${safeName}.db`);
  
  const resolved = path.resolve(dbPath);
  if (!resolved.startsWith(DB_DIR + path.sep)) {
    throw new Error("Invalid database path");
  }
  
  const db = new Database(dbPath);
  db.close();
  
  fs.chmodSync(dbPath, 0o600);
  
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
  
  validateTableName(db, tableName);
  
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
  
  validateTableName(db, tableName);
  
  let query = `SELECT * FROM "${tableName}"`;
  if (orderBy) {
    validateColumnName(db, tableName, orderBy);
    const dir = orderDir.toLowerCase() === "desc" ? "DESC" : "ASC";
    query += ` ORDER BY "${orderBy}" ${dir}`;
  }
  query += ` LIMIT ? OFFSET ?`;
  
  const safeLimit = Math.min(Math.max(1, Math.floor(Number(limit) || 100)), 1000);
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  
  const rows = db.prepare(query).all(safeLimit, safeOffset) as Record<string, unknown>[];
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
  
  validateTableName(db, tableName);
  
  const validColumns = getValidColumns(db, tableName);
  const columnNames = Object.keys(data);
  
  for (const col of columnNames) {
    if (!validColumns.has(col)) {
      throw new Error(`Column '${col}' does not exist in table '${tableName}'`);
    }
  }
  
  const values = Object.values(data);
  const placeholders = columnNames.map(() => "?").join(", ");
  
  const query = `INSERT INTO "${tableName}" (${columnNames.map(c => `"${c}"`).join(", ")}) VALUES (${placeholders})`;
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
  
  validateTableName(db, tableName);
  validateColumnName(db, tableName, pkColumn);
  
  const validColumns = getValidColumns(db, tableName);
  const updateColumns = Object.keys(data);
  
  for (const col of updateColumns) {
    if (!validColumns.has(col)) {
      throw new Error(`Column '${col}' does not exist in table '${tableName}'`);
    }
  }
  
  const setClauses = updateColumns.map(col => `"${col}" = ?`).join(", ");
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
  
  validateTableName(db, tableName);
  validateColumnName(db, tableName, pkColumn);
  
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
  
  if (!sql || typeof sql !== "string" || sql.trim().length === 0) {
    throw new Error("SQL query is required");
  }
  
  if (sql.length > 10000) {
    throw new Error("SQL query is too long");
  }
  
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
