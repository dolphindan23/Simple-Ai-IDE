import type * as monaco from "monaco-editor";

export const TERMINAL_NOIR_THEME_NAME = "terminal-noir";

export function defineTerminalNoirTheme(m: typeof monaco) {
  m.editor.defineTheme(TERMINAL_NOIR_THEME_NAME, {
    base: "vs-dark",
    inherit: true,

    rules: [
      { token: "", foreground: "E6EAF2" },
      { token: "comment", foreground: "6E7888", fontStyle: "italic" },
      { token: "string", foreground: "C7F9D4" },
      { token: "number", foreground: "FFD17A" },
      { token: "keyword", foreground: "B9A6FF", fontStyle: "bold" },
      { token: "type", foreground: "8ED0FF" },
      { token: "delimiter", foreground: "9AA4B2" },
      { token: "operator", foreground: "9AA4B2" },

      { token: "identifier", foreground: "E6EAF2" },
      { token: "variable", foreground: "D7DDEE" },
      { token: "function", foreground: "E9ECF5", fontStyle: "bold" },

      { token: "key", foreground: "E6EAF2" },

      { token: "invalid", foreground: "FF5C5C" },
    ],

    colors: {
      "editor.background": "#0C1020",
      "editor.foreground": "#E6EAF2",
      "editorLineNumber.foreground": "#6E7888",
      "editorLineNumber.activeForeground": "#9AA4B2",

      "editorCursor.foreground": "#FFB454",
      "editor.selectionBackground": "#2A231A",
      "editor.inactiveSelectionBackground": "#1C1A18",
      "editor.selectionHighlightBackground": "#2A231A",
      "editor.wordHighlightBackground": "#1A223A",
      "editor.wordHighlightStrongBackground": "#232E4A",

      "editor.lineHighlightBackground": "#0F1426",
      "editor.lineHighlightBorder": "#0F1426",
      "editorIndentGuide.background1": "#1F2A44",
      "editorIndentGuide.activeBackground1": "#232E4A",

      "editor.findMatchBackground": "#2A231A",
      "editor.findMatchHighlightBackground": "#1C1A18",
      "editor.findRangeHighlightBackground": "#111726",

      "editorBracketMatch.background": "#151C2E",
      "editorBracketMatch.border": "#FFB454",

      "editorWhitespace.foreground": "#1F2A44",
      "editorRuler.foreground": "#1F2A44",

      "editorGutter.background": "#0C1020",
      "minimap.background": "#0B0E14",

      "editorSuggestWidget.background": "#111726",
      "editorSuggestWidget.border": "#1F2A44",
      "editorSuggestWidget.foreground": "#E6EAF2",
      "editorSuggestWidget.selectedBackground": "#151C2E",

      "editorHoverWidget.background": "#111726",
      "editorHoverWidget.border": "#1F2A44",

      "editorError.foreground": "#FF5C5C",
      "editorWarning.foreground": "#FFC857",
      "editorInfo.foreground": "#7C8CFF",
    },
  });
}
