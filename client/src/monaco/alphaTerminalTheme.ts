import type * as monaco from "monaco-editor";

export const ALPHA_TERMINAL_THEME_NAME = "alpha-terminal";

export function defineAlphaTerminalTheme(m: typeof monaco) {
  m.editor.defineTheme(ALPHA_TERMINAL_THEME_NAME, {
    base: "vs-dark",
    inherit: true,

    rules: [
      { token: "", foreground: "EAF0FF" },
      { token: "comment", foreground: "6F7A92", fontStyle: "italic" },
      { token: "string", foreground: "B7F7FF" },
      { token: "number", foreground: "FFD17A" },
      { token: "keyword", foreground: "DDA0FF", fontStyle: "bold" },
      { token: "type", foreground: "86D7FF" },
      { token: "function", foreground: "F1F4FF", fontStyle: "bold" },
      { token: "variable", foreground: "D7DEF2" },
      { token: "identifier", foreground: "EAF0FF" },
      { token: "delimiter", foreground: "A5B0C7" },
      { token: "operator", foreground: "A5B0C7" },
      { token: "key", foreground: "EAF0FF" },
      { token: "invalid", foreground: "FF4D6D" },
    ],

    colors: {
      "editor.background": "#060A14",
      "editor.foreground": "#EAF0FF",
      "editorLineNumber.foreground": "#55607A",
      "editorLineNumber.activeForeground": "#A5B0C7",

      "editorCursor.foreground": "#00E6FF",
      "editor.selectionBackground": "#082334",
      "editor.inactiveSelectionBackground": "#071A26",
      "editor.selectionHighlightBackground": "#082334",
      "editor.wordHighlightBackground": "#0D142A",
      "editor.wordHighlightStrongBackground": "#101A34",

      "editor.lineHighlightBackground": "#0A1020",
      "editor.lineHighlightBorder": "#0A1020",
      "editorIndentGuide.background1": "#182344",
      "editorIndentGuide.activeBackground1": "#24325A",

      "editor.findMatchBackground": "#2A0B2A",
      "editor.findMatchHighlightBackground": "#140B18",
      "editor.findRangeHighlightBackground": "#0B1020",

      "editorBracketMatch.background": "#0D142A",
      "editorBracketMatch.border": "#FF2DFF",

      "editorWhitespace.foreground": "#182344",
      "editorRuler.foreground": "#182344",

      "editorGutter.background": "#060A14",
      "minimap.background": "#070A12",

      "editorSuggestWidget.background": "#0B1020",
      "editorSuggestWidget.border": "#1A2550",
      "editorSuggestWidget.foreground": "#EAF0FF",
      "editorSuggestWidget.selectedBackground": "#0D142A",

      "editorHoverWidget.background": "#0B1020",
      "editorHoverWidget.border": "#1A2550",

      "editorError.foreground": "#FF4D6D",
      "editorWarning.foreground": "#FFB454",
      "editorInfo.foreground": "#00E6FF",
    },
  });
}
