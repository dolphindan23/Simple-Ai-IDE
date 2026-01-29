# SimpleAide - AI-Powered Coding Workspace

## Overview
SimpleAide is a minimal, Replit-style coding workspace with an AI-powered multi-agent workflow. It features a Monaco-based code editor, file tree explorer, terminal output panel, and an AI Team sidebar that can generate plans, implement code, run tests, and review changes.

## Key Features
- **Workspace Header**: Replit-style tab bar with Editor, Preview, Database, Secrets, Console, Shell, Developer, AI Agents tabs
- **File Tree**: Browse project files with collapsible folders
- **Monaco Editor**: Professional code editing with syntax highlighting, IntelliSense, and full editing support
- **File Operations**: Save (Ctrl+S), New File, New Folder, Rename, Delete, Duplicate, Copy Path via File menu
- **Settings System**: Persistent settings in .simpleaide/settings.json with 2 tabs (General, Editor)
- **Encrypted Secrets Vault**: AES-256-GCM encrypted secrets storage in .simpleaide/secrets.enc with master password protection and vault reset capability
- **Custom API Services**: Store any user-defined API services (OpenAI, Anthropic, etc.) with custom names and endpoints
- **Integration Testing**: Test Connection buttons for Kaggle, HuggingFace, and NGC integrations
- **AI Team Panel**: Execute AI tasks (Plan, Implement, Test, Review)
- **AI Agents Panel**: Configure multiple LLM backends and assign roles (Planner, Coder, Reviewer, TestFixer, Doc) with per-role model settings
- **Terminal Panel**: Collapsible/resizable output panel with 3 states (expanded/collapsed/hidden)
- **Diff-First Approach**: AI generates diffs that users can review and apply
- **AI Orchestration**: Configurable AI backends via AI Agents panel with role-based routing and fallback
- **Dark/Light Theme**: Toggle between themes
- **Keyboard Shortcuts**: Ctrl+S save, Ctrl+J toggle terminal, Ctrl+` show/focus terminal

## Architecture

### Frontend (React + TypeScript)
```
client/src/
├── components/
│   ├── AIAgentsPanel.tsx    # AI backends and roles configuration
│   ├── AITeamPanel.tsx      # AI workflow sidebar
│   ├── CodeEditor.tsx       # Monaco editor wrapper
│   ├── DiffViewer.tsx       # Unified diff display
│   ├── FileTree.tsx         # Project file browser
│   ├── SecretsPanel.tsx     # Secrets vault and API integrations panel
│   ├── SettingsModal.tsx    # Settings dialog with 2 tabs (General, Editor)
│   ├── TerminalPanel.tsx    # Log output with 3 states
│   ├── ThemeProvider.tsx    # Dark/light theme context
│   └── WorkspaceHeader.tsx  # Tab bar (Editor/Preview/AI Agents/etc.)
├── pages/
│   └── ide.tsx              # Main IDE layout
└── App.tsx                  # App entry with routing
```

### Backend (Express + TypeScript)
```
server/
├── routes.ts      # API endpoints
├── storage.ts     # In-memory task/artifact storage
├── taskRunner.ts  # Task execution and AI orchestration
├── secrets.ts     # Encrypted secrets vault management
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
| PUT | /api/fs/file | Write file content |
| POST | /api/fs/new-file | Create new file |
| POST | /api/fs/new-folder | Create new folder |
| POST | /api/fs/rename | Rename file or folder |
| POST | /api/fs/delete | Delete file or folder |
| POST | /api/fs/duplicate | Duplicate file |
| GET | /api/settings | Get settings from .simpleaide/settings.json |
| PUT | /api/settings | Save all settings |
| PATCH | /api/settings/:section | Update specific settings section |
| GET | /api/secrets/status | Check vault exists/unlocked status |
| POST | /api/secrets/create | Create new vault with master password |
| POST | /api/secrets/unlock | Unlock vault with master password |
| POST | /api/secrets/lock | Lock vault (clear session) |
| GET | /api/secrets | List secrets with masked values |
| PUT | /api/secrets/:key | Add or update a secret |
| DELETE | /api/secrets/:key | Delete a secret |
| POST | /api/integrations/test/:provider | Test integration connection (kaggle/huggingface/ngc) |
| POST | /api/ai-agents/test-backend | Test AI backend connection and fetch available models |
| POST | /api/ai-agents/chat | Orchestrator endpoint for role-based AI chat with fallback |

## AI Agents System

The AI Agents system allows configuring multiple LLM backends and assigning them to specific agent roles:

### Backends
- **Name**: Display name for the backend
- **Base URL**: Ollama-compatible API endpoint (e.g., http://localhost:11434)
- **Auth Type**: none, basic (username/password), or bearer (token)
- **Credentials**: Stored in encrypted vault as BACKEND_{id}_TOKEN/USERNAME/PASSWORD

### Agent Roles
5 specialized roles with individual configurations:
- **Planner**: Generates implementation plans
- **Coder**: Writes code implementations
- **Reviewer**: Reviews code for quality
- **TestFixer**: Fixes failing tests
- **Doc**: Generates documentation

Each role can specify:
- Backend to use (or default)
- Model name
- Temperature (0-2)
- Context length (num_ctx)

### Orchestrator
The `/api/ai-agents/chat` endpoint routes requests based on role:
1. Uses the role's configured backend if available
2. Falls back to default backend
3. Falls back to first available backend
4. Returns error if no backend available

## Secrets Vault

The secrets vault provides secure storage for API keys and tokens:
- **Encryption**: AES-256-GCM with random IV
- **Key Derivation**: PBKDF2 with 100,000 iterations and random salt
- **Storage**: .simpleaide/secrets.enc (encrypted blob)
- **Session**: In-memory unlock state (cleared on server restart)

Expected secret keys for integrations:
- `KAGGLE_API_KEY` - Kaggle API key
- `HUGGINGFACE_TOKEN` - HuggingFace access token
- `NGC_API_KEY` - NVIDIA NGC API key

## Task Modes

1. **Plan**: Generates an implementation plan with steps, files, and test strategy
2. **Implement**: Generates code changes as unified diffs
3. **Test**: Runs tests or generates test suggestions
4. **Review**: Generates code review feedback

## Ollama Integration

SimpleAide uses Ollama as the AI backend. Default configuration:
- Base URL: `http://localhost:11434`
- Model: `codellama`

When Ollama is not available, the system falls back to stub responses for demonstration purposes.

To use with Ollama:
1. Install Ollama: https://ollama.ai
2. Pull a model: `ollama pull codellama`
3. Run Ollama: `ollama serve`
4. Configure URL/model in SimpleAide settings

## Development

### Requirements
- Node.js 18+ (required for native fetch support)

### Running the Application
```bash
npm run dev
```

The app serves on port 8521 with both frontend and backend.

### Technology Stack
- **Frontend**: React 18, TanStack Query, Monaco Editor, Tailwind CSS, shadcn/ui
- **Backend**: Express.js, TypeScript, Node.js 20 (native fetch)
- **AI**: Ollama (local LLM)
- **Security**: AES-256-GCM encryption, PBKDF2 key derivation
- **Styling**: Dark/light theme support with CSS variables

## User Preferences
- Dark theme by default (IDE-focused design)
- JetBrains Mono font for code
- Diff-first workflow (agents propose changes, users apply)

## Recent Changes
- 2026-01-29: Initial MVP with file tree, Monaco editor, AI Team panel, and Ollama integration
- 2026-01-29: Phase A - Added full file editing capabilities with dirty state tracking, Ctrl+S save, and File menu (New File, New Folder, Rename, Delete, Duplicate, Copy Path)
- 2026-01-29: Phase B - Added Settings modal with 5 tabs (General, Editor, AI, Integrations, Security), persisted to .simpleaide/settings.json
- 2026-01-29: Phase C1 - Added encrypted secrets vault with AES-256-GCM encryption, master password unlock, and CRUD operations
- 2026-01-29: Phase C2 - Added Test Connection buttons for Kaggle, HuggingFace, and NGC integrations
- 2026-01-29: Security hardening - File permissions (0600), redactSecrets() log scrubber, vault auto-lock (15 min default), LOCAL_INSTALL.md
- 2026-01-29: Workspace Header - Added Replit-style tab bar with Editor, Preview, Database, Secrets, Console, Shell, Developer tabs
- 2026-01-29: Terminal improvements - 3 states (expanded/collapsed/hidden), draggable resize, Ctrl+J and Ctrl+` shortcuts, localStorage persistence
- 2026-01-29: AI Agents - Added AI Agents tab with multi-backend management, role configuration (Planner/Coder/Reviewer/TestFixer/Doc), orchestrator with fallback routing, vault-stored credentials
- 2026-01-29: Consolidated AI configuration - Removed AI tab from Settings modal, all AI backend config now in AI Agents panel
- 2026-01-29: Streamlined UI - Moved Secrets/Vault and API Integrations to dedicated Secrets workspace tab, Settings modal now only has General and Editor tabs (2 tabs)
- 2026-01-29: Vault reset and custom APIs - Added vault reset button with confirmation dialog, added Custom tab for user-defined API services with name/key/endpoint storage
- 2026-01-29: Phase D1 - Workflow Engine with checkpoints: Added TaskRun/StepRun types, file-based runs storage (.simpleaide/runs/), REST APIs for run management (create, list, execute step, rerun from checkpoint), Run Timeline UI with step status visualization and artifact viewing
- 2026-01-29: Phase D2 - Autonomous test/fix loop: Added auto workflow (Plan→Code→Apply→Test→Fix chain), file backup/restore for safe diff application, TestFixer retry loop (max 3 attempts), Apply Diff buttons in UI

## Workflow Engine (Phase D)

### Run Storage Structure
```
.simpleaide/runs/
└── <runId>/
    ├── run.json           # Run metadata (goal, status, timestamps)
    ├── 01_plan/
    │   ├── input.json     # Step input parameters
    │   ├── status.json    # Step status metadata
    │   └── plan.json      # Generated artifact
    ├── 02_implement/
    │   ├── input.json
    │   ├── status.json
    │   └── patch.diff     # Generated diff
    └── ...
```

### Run API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/runs | Create new run |
| GET | /api/runs | List all runs |
| GET | /api/runs/:id | Get run with all steps |
| POST | /api/runs/:id/step | Execute a step |
| POST | /api/runs/:id/rerun | Rerun from checkpoint |
| POST | /api/runs/:id/complete | Mark run complete/failed/cancelled |
| GET | /api/runs/:id/steps/:stepNum/artifact/:name | Get step artifact |

### Step Types
- **plan**: Generate implementation plan
- **implement**: Generate code changes as diff
- **review**: Code review feedback
- **test**: Run tests or generate test suggestions
- **fix**: Fix failing tests

### Step Statuses
- pending, running, passed, failed, skipped

### Phase D2: Auto Workflow
The auto workflow chains steps together automatically:
1. **Plan** - Generate implementation plan
2. **Implement** - Generate code as unified diff
3. **Apply** - Apply diff to files (with backup)
4. **Test** - Run npm test
5. **Fix** - If tests fail, generate fix diff and retry (max 3 attempts)
6. **Review** - Final code review

### Backup System
- Backups stored in `.simpleaide/backups/<backupId>/`
- Files backed up before diff application
- Can revert using backup ID
- Automatic cleanup after successful workflow

### Auto Workflow API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/runs/:id/auto | Start autonomous workflow |
| POST | /api/runs/:id/steps/:stepNum/apply | Apply a diff with backup |
| POST | /api/runs/revert | Revert changes using backup ID |
