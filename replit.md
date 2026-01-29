# SimpleIDE - AI-Powered Coding Workspace

## Overview
SimpleIDE is a minimal, Replit-style coding workspace with an AI-powered multi-agent workflow. It features a Monaco-based code editor, file tree explorer, terminal output panel, and an AI Team sidebar that can generate plans, implement code, run tests, and review changes.

## Key Features
- **File Tree**: Browse project files with collapsible folders
- **Monaco Editor**: Professional code editing with syntax highlighting and IntelliSense
- **AI Team Panel**: Execute AI tasks (Plan, Implement, Test, Review)
- **Terminal Panel**: View real-time task logs via SSE streaming
- **Diff-First Approach**: AI generates diffs that users can review and apply
- **Ollama Integration**: Uses local Ollama for AI capabilities (with graceful fallback to stubs)
- **Dark/Light Theme**: Toggle between themes

## Architecture

### Frontend (React + TypeScript)
```
client/src/
├── components/
│   ├── AITeamPanel.tsx    # AI workflow sidebar
│   ├── CodeEditor.tsx     # Monaco editor wrapper
│   ├── DiffViewer.tsx     # Unified diff display
│   ├── FileTree.tsx       # Project file browser
│   ├── TerminalPanel.tsx  # Log output display
│   └── ThemeProvider.tsx  # Dark/light theme context
├── pages/
│   └── ide.tsx            # Main IDE layout
└── App.tsx                # App entry with routing
```

### Backend (Express + TypeScript)
```
server/
├── routes.ts      # API endpoints
├── storage.ts     # In-memory task/artifact storage
├── taskRunner.ts  # Task execution and AI orchestration
└── ollama.ts      # Ollama API adapter
```

### Shared
```
shared/
└── schema.ts      # TypeScript types and Zod schemas
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/files | Get project file tree |
| GET | /api/files/content | Get file content by path |
| POST | /api/tasks | Create a new AI task |
| GET | /api/tasks/:id | Get task status |
| GET | /api/tasks/:id/events | SSE stream for task logs |
| GET | /api/tasks/:id/diffs | List generated diffs |
| GET | /api/tasks/:id/artifact | Get artifact content |
| POST | /api/tasks/:id/apply | Apply a diff to the project |

## Task Modes

1. **Plan**: Generates an implementation plan with steps, files, and test strategy
2. **Implement**: Generates code changes as unified diffs
3. **Test**: Runs tests or generates test suggestions
4. **Review**: Generates code review feedback

## Ollama Integration

SimpleIDE uses Ollama as the AI backend. Default configuration:
- Base URL: `http://localhost:11434`
- Model: `codellama`

When Ollama is not available, the system falls back to stub responses for demonstration purposes.

To use with Ollama:
1. Install Ollama: https://ollama.ai
2. Pull a model: `ollama pull codellama`
3. Run Ollama: `ollama serve`
4. Configure URL/model in SimpleIDE settings

## Development

### Running the Application
```bash
npm run dev
```

The app serves on port 5000 with both frontend and backend.

### Technology Stack
- **Frontend**: React 18, TanStack Query, Monaco Editor, Tailwind CSS, shadcn/ui
- **Backend**: Express.js, TypeScript
- **AI**: Ollama (local LLM)
- **Styling**: Dark/light theme support with CSS variables

## User Preferences
- Dark theme by default (IDE-focused design)
- JetBrains Mono font for code
- Diff-first workflow (agents propose changes, users apply)

## Recent Changes
- 2026-01-29: Initial MVP with file tree, Monaco editor, AI Team panel, and Ollama integration
