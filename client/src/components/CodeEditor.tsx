import Editor, { OnMount, BeforeMount } from "@monaco-editor/react";
import { useTheme } from "./ThemeProvider";
import { Loader2 } from "lucide-react";
import { defineTerminalNoirTheme, TERMINAL_NOIR_THEME_NAME } from "@/monaco/terminalNoirTheme";

interface CodeEditorProps {
  value: string;
  onChange?: (value: string | undefined) => void;
  language?: string;
  readOnly?: boolean;
  path?: string;
}

export function CodeEditor({ value, onChange, language, readOnly = false, path }: CodeEditorProps) {
  const { theme } = useTheme();

  const getLanguageFromPath = (filePath: string | undefined): string => {
    if (!filePath) return "plaintext";
    const ext = filePath.split(".").pop()?.toLowerCase();
    
    const languageMap: Record<string, string> = {
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      py: "python",
      json: "json",
      md: "markdown",
      css: "css",
      html: "html",
      yaml: "yaml",
      yml: "yaml",
      sh: "shell",
      bash: "shell",
      sql: "sql",
      diff: "diff",
    };
    
    return languageMap[ext || ""] || "plaintext";
  };

  const getMonacoTheme = () => {
    switch (theme) {
      case "terminal-noir": return TERMINAL_NOIR_THEME_NAME;
      case "light": return "simpleaide-light";
      default: return "simpleaide-dark";
    }
  };

  const handleBeforeMount: BeforeMount = (monaco) => {
    defineTerminalNoirTheme(monaco);

    monaco.editor.defineTheme("simpleaide-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6a9955", fontStyle: "italic" },
        { token: "keyword", foreground: "569cd6" },
        { token: "string", foreground: "ce9178" },
        { token: "number", foreground: "b5cea8" },
        { token: "type", foreground: "4ec9b0" },
        { token: "function", foreground: "dcdcaa" },
        { token: "variable", foreground: "9cdcfe" },
      ],
      colors: {
        "editor.background": "#0f172a",
        "editor.foreground": "#e2e8f0",
        "editor.lineHighlightBackground": "#1e293b",
        "editor.selectionBackground": "#334155",
        "editorCursor.foreground": "#3b82f6",
        "editorLineNumber.foreground": "#475569",
        "editorLineNumber.activeForeground": "#94a3b8",
        "editor.inactiveSelectionBackground": "#1e293b",
      },
    });

    monaco.editor.defineTheme("simpleaide-light", {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "008000", fontStyle: "italic" },
        { token: "keyword", foreground: "0000ff" },
        { token: "string", foreground: "a31515" },
        { token: "number", foreground: "098658" },
        { token: "type", foreground: "267f99" },
        { token: "function", foreground: "795e26" },
        { token: "variable", foreground: "001080" },
      ],
      colors: {
        "editor.background": "#f8fafc",
        "editor.foreground": "#1e293b",
        "editor.lineHighlightBackground": "#f1f5f9",
        "editor.selectionBackground": "#add6ff",
        "editorCursor.foreground": "#3b82f6",
        "editorLineNumber.foreground": "#94a3b8",
        "editorLineNumber.activeForeground": "#475569",
      },
    });
  };

  const handleEditorMount: OnMount = (editor) => {
    editor.updateOptions({
      minimap: { enabled: true, scale: 0.8 },
      scrollBeyondLastLine: false,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontLigatures: true,
      lineHeight: 1.55,
      lineNumbers: "on",
      renderLineHighlight: "all",
      cursorBlinking: "smooth",
      cursorSmoothCaretAnimation: "on",
      smoothScrolling: true,
      padding: { top: 12 },
      bracketPairColorization: { enabled: true },
      wordWrap: "off",
      tabSize: 2,
    });
  };

  return (
    <Editor
      height="100%"
      defaultLanguage={language || getLanguageFromPath(path)}
      value={value}
      onChange={onChange}
      theme={getMonacoTheme()}
      beforeMount={handleBeforeMount}
      onMount={handleEditorMount}
      loading={
        <div className="flex items-center justify-center h-full bg-background">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      }
      options={{
        readOnly,
        domReadOnly: readOnly,
      }}
    />
  );
}
