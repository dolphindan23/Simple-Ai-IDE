import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Database, Table, Search, Plus, Trash2, Save, RefreshCw, Play, Link2, ChevronDown, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface DatabaseInfo {
  name: string;
  type: "sqlite" | "postgres";
  path?: string;
  connectionString?: string;
}

interface TableInfo {
  name: string;
  rowCount: number;
  hasFK: boolean;
}

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
}

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  affectedRows?: number;
}

interface StatusResponse {
  env: "DEV" | "PROD";
}

export function DatabasePanel() {
  const { toast } = useToast();
  const [selectedDb, setSelectedDb] = useState<DatabaseInfo | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "sql">("grid");
  const [sqlQuery, setSqlQuery] = useState("");
  const [editedRows, setEditedRows] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [newRowDialog, setNewRowDialog] = useState(false);
  const [newRowData, setNewRowData] = useState<Record<string, string>>({});
  const [createDbDialog, setCreateDbDialog] = useState(false);
  const [newDbName, setNewDbName] = useState("");

  // Fetch current environment from status
  const { data: statusData } = useQuery<StatusResponse>({
    queryKey: ["/api/status"],
    staleTime: 10000,
  });
  
  const isProd = statusData?.env === "PROD";
  const env = isProd ? "prod" : "dev";

  const { data: databases = [], refetch: refetchDatabases } = useQuery<DatabaseInfo[]>({
    queryKey: ["/api/db/list"],
  });

  const { data: tables = [], refetch: refetchTables } = useQuery<TableInfo[]>({
    queryKey: ["/api/db", env, "tables", selectedDb?.path],
    enabled: !!selectedDb?.path,
    queryFn: async () => {
      const res = await fetch(`/api/db/${env}/tables?path=${encodeURIComponent(selectedDb!.path!)}`);
      if (!res.ok) throw new Error("Failed to fetch tables");
      return res.json();
    },
  });

  const { data: schema = [] } = useQuery<ColumnInfo[]>({
    queryKey: ["/api/db", env, "schema", selectedDb?.path, selectedTable],
    enabled: !!selectedDb?.path && !!selectedTable,
    queryFn: async () => {
      const res = await fetch(`/api/db/${env}/schema/${selectedTable}?path=${encodeURIComponent(selectedDb!.path!)}`);
      if (!res.ok) throw new Error("Failed to fetch schema");
      return res.json();
    },
  });

  const { data: rowsData, refetch: refetchRows } = useQuery<QueryResult>({
    queryKey: ["/api/db", env, "rows", selectedDb?.path, selectedTable],
    enabled: !!selectedDb?.path && !!selectedTable && viewMode === "grid",
    queryFn: async () => {
      const res = await fetch(`/api/db/${env}/rows/${selectedTable}?path=${encodeURIComponent(selectedDb!.path!)}&limit=100`);
      if (!res.ok) throw new Error("Failed to fetch rows");
      return res.json();
    },
  });

  const createDbMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/db/create", { name });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Database created", description: data.name });
      refetchDatabases();
      setSelectedDb(data);
      setCreateDbDialog(false);
      setNewDbName("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const insertRowMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", `/api/db/${env}/rows/${selectedTable}?path=${encodeURIComponent(selectedDb!.path!)}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Row inserted" });
      refetchRows();
      refetchTables();
      setNewRowDialog(false);
      setNewRowData({});
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateRowMutation = useMutation({
    mutationFn: async ({ pkColumn, pkValue, data }: { pkColumn: string; pkValue: unknown; data: Record<string, unknown> }) => {
      const res = await apiRequest(
        "PUT", 
        `/api/db/${env}/rows/${selectedTable}/${pkValue}?path=${encodeURIComponent(selectedDb!.path!)}&pkColumn=${pkColumn}`,
        data
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Row updated" });
      refetchRows();
      setEditedRows(new Map());
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteRowMutation = useMutation({
    mutationFn: async ({ pkColumn, pkValue }: { pkColumn: string; pkValue: unknown }) => {
      const res = await apiRequest(
        "DELETE",
        `/api/db/${env}/rows/${selectedTable}/${pkValue}?path=${encodeURIComponent(selectedDb!.path!)}&pkColumn=${pkColumn}`
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Row deleted" });
      refetchRows();
      refetchTables();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const executeSqlMutation = useMutation({
    mutationFn: async (sql: string) => {
      const res = await apiRequest(
        "POST",
        `/api/db/${env}/query?path=${encodeURIComponent(selectedDb!.path!)}`,
        { sql }
      );
      return res.json();
    },
    onError: (error: Error) => {
      toast({ title: "SQL Error", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (databases.length > 0 && !selectedDb) {
      setSelectedDb(databases[0]);
    }
  }, [databases, selectedDb]);

  useEffect(() => {
    if (tables.length > 0 && !selectedTable) {
      setSelectedTable(tables[0].name);
    }
  }, [tables, selectedTable]);

  const filteredTables = tables.filter(t => 
    t.name.toLowerCase().includes(tableFilter.toLowerCase())
  );

  const pkColumn = schema.find(c => c.primaryKey)?.name || schema[0]?.name;

  const handleCellChange = (rowIndex: number, column: string, value: string) => {
    const row = rowsData?.rows[rowIndex];
    if (!row || !pkColumn) return;
    
    const pkValue = String(row[pkColumn]);
    const existingEdit = editedRows.get(pkValue) || { ...row };
    existingEdit[column] = value;
    
    const newEdits = new Map(editedRows);
    newEdits.set(pkValue, existingEdit);
    setEditedRows(newEdits);
  };

  const handleSaveChanges = () => {
    if (!pkColumn) return;
    
    editedRows.forEach((data, pkValue) => {
      const originalRow = rowsData?.rows.find(r => String(r[pkColumn]) === pkValue);
      if (!originalRow) return;
      
      const changes: Record<string, unknown> = {};
      for (const key of Object.keys(data)) {
        if (key !== pkColumn && data[key] !== originalRow[key]) {
          changes[key] = data[key];
        }
      }
      
      if (Object.keys(changes).length > 0) {
        updateRowMutation.mutate({ pkColumn, pkValue, data: changes });
      }
    });
  };

  const handleDeleteRow = (row: Record<string, unknown>) => {
    if (!pkColumn) return;
    const pkValue = row[pkColumn];
    deleteRowMutation.mutate({ pkColumn, pkValue });
  };

  const handleAddRow = () => {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(newRowData)) {
      if (value !== "") {
        data[key] = value;
      }
    }
    insertRowMutation.mutate(data);
  };

  const handleExecuteSql = () => {
    if (!sqlQuery.trim()) return;
    executeSqlMutation.mutate(sqlQuery);
  };

  const sqlResult = executeSqlMutation.data;
  const displayData = viewMode === "sql" && sqlResult ? sqlResult : rowsData;

  return (
    <div className="flex h-full bg-background">
      {/* Left Sidebar - Tables */}
      <div className="w-56 border-r flex flex-col shrink-0">
        <div className="p-3 border-b space-y-2">
          {/* Database Selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="w-full justify-between gap-2" data-testid="dropdown-database">
                <div className="flex items-center gap-2 truncate">
                  <Database className="h-4 w-4 shrink-0" />
                  <span className="truncate text-xs">
                    {selectedDb ? selectedDb.name : "Select Database"}
                  </span>
                </div>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {databases.map((db) => (
                <DropdownMenuItem
                  key={db.name}
                  onClick={() => {
                    setSelectedDb(db);
                    setSelectedTable(null);
                  }}
                  data-testid={`menu-db-${db.name}`}
                >
                  <Database className="h-4 w-4 mr-2" />
                  <span className="truncate">{db.name}</span>
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    {db.type}
                  </Badge>
                </DropdownMenuItem>
              ))}
              {!isProd && (
                <DropdownMenuItem onClick={() => setCreateDbDialog(true)} data-testid="menu-create-db">
                  <Plus className="h-4 w-4 mr-2" />
                  Create New Database
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Environment indicator */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Environment:</span>
            {isProd ? (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                <Lock className="h-2.5 w-2.5 mr-1" />
                Read-only
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                DEV
              </Badge>
            )}
          </div>

          {/* Table Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={tableFilter}
              onChange={(e) => setTableFilter(e.target.value)}
              placeholder="Filter tables..."
              className="pl-8 h-8 text-xs"
              data-testid="input-table-filter"
            />
          </div>
        </div>

        {/* Tables List */}
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {filteredTables.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                {tables.length === 0 ? "No tables found" : "No matches"}
              </p>
            )}
            {filteredTables.map((table) => (
              <button
                key={table.name}
                onClick={() => setSelectedTable(table.name)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors",
                  selectedTable === table.name
                    ? "bg-accent text-accent-foreground font-medium"
                    : "hover-elevate"
                )}
                data-testid={`table-${table.name}`}
              >
                {table.hasFK ? (
                  <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <Table className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                <span className="truncate flex-1">{table.name}</span>
                <span className="text-[10px] text-muted-foreground">{table.rowCount}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b gap-2">
          <div className="flex items-center gap-3">
            <h2 className="font-medium text-sm">
              {selectedTable || "Select a table"}
            </h2>
            {displayData && (
              <span className="text-xs text-muted-foreground">
                {displayData.rowCount} rows
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "grid" | "sql")}>
              <TabsList className="h-8">
                <TabsTrigger value="grid" className="text-xs h-7 px-3" data-testid="tab-grid">
                  Grid View
                </TabsTrigger>
                <TabsTrigger value="sql" className="text-xs h-7 px-3" data-testid="tab-sql">
                  SQL View
                </TabsTrigger>
              </TabsList>
            </Tabs>
            
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                refetchRows();
                refetchTables();
              }}
              data-testid="button-refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* SQL Input (only in SQL view) */}
        {viewMode === "sql" && (
          <div className="px-4 py-2 border-b space-y-2">
            {isProd && (
              <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-500/10 px-2 py-1.5 rounded-md border border-amber-500/20">
                <Lock className="h-3 w-3" />
                <span>Production mode: Only SELECT, PRAGMA, and EXPLAIN queries are allowed.</span>
              </div>
            )}
            <textarea
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
              placeholder={isProd ? "SELECT * FROM table_name LIMIT 100;" : "SELECT * FROM table_name LIMIT 100; -- or INSERT/UPDATE/DELETE"}
              className="w-full h-20 p-2 text-sm font-mono bg-muted/50 border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              data-testid="textarea-sql"
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleExecuteSql}
                disabled={!sqlQuery.trim() || executeSqlMutation.isPending}
                data-testid="button-execute-sql"
              >
                <Play className="h-3.5 w-3.5 mr-1.5" />
                Execute
              </Button>
              {sqlResult && sqlResult.affectedRows !== undefined && (
                <span className="text-xs text-muted-foreground">
                  {sqlResult.affectedRows} rows affected
                </span>
              )}
            </div>
          </div>
        )}

        {/* Grid View Actions */}
        {viewMode === "grid" && selectedTable && (
          <div className="flex items-center gap-2 px-4 py-2 border-b">
            {!isProd && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNewRowDialog(true)}
                data-testid="button-add-row"
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add Row
              </Button>
            )}
            {!isProd && editedRows.size > 0 && (
              <Button
                size="sm"
                onClick={handleSaveChanges}
                disabled={updateRowMutation.isPending}
                data-testid="button-save-changes"
              >
                <Save className="h-3.5 w-3.5 mr-1.5" />
                Save Changes ({editedRows.size})
              </Button>
            )}
            {isProd && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" />
                <span>Read-only in production mode</span>
              </div>
            )}
          </div>
        )}

        {/* Data Grid */}
        <ScrollArea className="flex-1">
          <div className="min-w-full">
            {!selectedDb ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <Database className="h-12 w-12 mb-3 opacity-30" />
                <p className="text-sm">Select or create a database to get started</p>
              </div>
            ) : !selectedTable ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <Table className="h-12 w-12 mb-3 opacity-30" />
                <p className="text-sm">Select a table from the sidebar</p>
              </div>
            ) : !displayData || displayData.rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <Table className="h-12 w-12 mb-3 opacity-30" />
                <p className="text-sm">No data in this table</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    {displayData.columns.map((col: string) => {
                      const colInfo = schema.find(c => c.name === col);
                      return (
                        <th
                          key={col}
                          className={cn(
                            "px-3 py-2 text-left font-medium text-xs border-b",
                            colInfo?.primaryKey && "bg-primary/5"
                          )}
                        >
                          <div className="flex items-center gap-1">
                            {col}
                            {colInfo?.primaryKey && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0">
                                PK
                              </Badge>
                            )}
                          </div>
                        </th>
                      );
                    })}
                    {viewMode === "grid" && !isProd && <th className="px-3 py-2 w-10 border-b" />}
                  </tr>
                </thead>
                <tbody>
                  {displayData.rows.map((row: Record<string, unknown>, rowIndex: number) => {
                    const pkValue = pkColumn ? String(row[pkColumn]) : String(rowIndex);
                    const editedRow = editedRows.get(pkValue);
                    
                    return (
                      <tr key={rowIndex} className="border-b hover:bg-muted/30">
                        {displayData.columns.map((col: string) => {
                          const value = editedRow ? editedRow[col] : row[col];
                          const displayValue = value === null ? "NULL" : String(value);
                          const colInfo = schema.find(c => c.name === col);
                          // Disable editing in PROD mode
                          const isEditable = viewMode === "grid" && !colInfo?.primaryKey && !isProd;
                          const isEdited = editedRow && editedRow[col] !== row[col];
                          
                          return (
                            <td
                              key={col}
                              className={cn(
                                "px-3 py-1.5 font-mono text-xs",
                                colInfo?.primaryKey && "bg-primary/5",
                                isEdited && "bg-yellow-500/10",
                                value === null && "text-muted-foreground italic"
                              )}
                            >
                              {isEditable ? (
                                <input
                                  type="text"
                                  value={displayValue === "NULL" ? "" : displayValue}
                                  onChange={(e) => handleCellChange(rowIndex, col, e.target.value)}
                                  className="w-full bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-primary rounded px-1 -mx-1"
                                  placeholder={value === null ? "NULL" : ""}
                                />
                              ) : (
                                <span className="truncate block max-w-[200px]">{displayValue}</span>
                              )}
                            </td>
                          );
                        })}
                        {viewMode === "grid" && !isProd && (
                          <td className="px-2 py-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => handleDeleteRow(row)}
                              disabled={deleteRowMutation.isPending}
                              data-testid={`button-delete-row-${rowIndex}`}
                            >
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Create Database Dialog */}
      <Dialog open={createDbDialog} onOpenChange={setCreateDbDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Database</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Database Name</Label>
              <Input
                value={newDbName}
                onChange={(e) => setNewDbName(e.target.value)}
                placeholder="myapp.db"
                data-testid="input-new-db-name"
              />
              <p className="text-xs text-muted-foreground">
                A new SQLite database will be created in .simpleaide/databases/
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDbDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createDbMutation.mutate(newDbName)}
              disabled={!newDbName.trim() || createDbMutation.isPending}
              data-testid="button-confirm-create-db"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Row Dialog */}
      <Dialog open={newRowDialog} onOpenChange={setNewRowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Row</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-3 py-4 pr-4">
              {schema.map((col) => (
                <div key={col.name} className="space-y-1">
                  <Label className="flex items-center gap-2">
                    {col.name}
                    {col.primaryKey && (
                      <Badge variant="outline" className="text-[9px]">PK</Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground font-normal">
                      {col.type}
                    </span>
                  </Label>
                  <Input
                    value={newRowData[col.name] || ""}
                    onChange={(e) => setNewRowData({ ...newRowData, [col.name]: e.target.value })}
                    placeholder={col.nullable ? "NULL" : "Required"}
                    data-testid={`input-new-row-${col.name}`}
                  />
                </div>
              ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewRowDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddRow}
              disabled={insertRowMutation.isPending}
              data-testid="button-confirm-add-row"
            >
              Insert Row
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
