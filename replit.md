# SimpleAide - AI-Powered Coding Workspace

## Overview
SimpleAide is an AI-powered coding workspace that integrates an AI-driven multi-agent workflow to streamline development. It provides a minimal yet powerful IDE experience by combining a Monaco-based code editor, a file tree, a terminal, and an AI Team sidebar. The project's core purpose is to leverage AI to enhance developer productivity, accelerate software delivery, and provide a comprehensive environment for planning, implementing, testing, and reviewing code.

## User Preferences
- Dark theme by default (IDE-focused design)
- JetBrains Mono font for code
- Diff-first workflow (agents propose changes, users apply)

## Recent Changes (January 2026)
- **Enhanced Status Strip**: Bloomberg-style status bar with CTX (context files), RUN (agent state), and Saved/Unsaved chips; left/right grouping for workspace vs infrastructure status
- **Settings Modal AI Tab**: Added 4th tab for AI defaults (action, speed, diff preview, confirm destructive)
- **Context Manager Drawer**: Visualize/manage AI file context with pin/search/clear functionality
- **Keyboard Shortcuts Modal**: Displays all keybindings organized by category (General, Editor, Panels, AI)
- **File Menu Cleanup**: Removed Duplicate, added Settings/Reload Window/Reset Layout/Shortcuts items
- **Right-click Context Menu**: FileTree nodes support context menu matching hover actions
- **Breadcrumbs Bar**: Shows current file path above Monaco editor with clickable segments
- **Theme Support**: Added "terminal-noir" theme option to generalSettingsSchema
- **Docker GPU Deployment**: Added Dockerfile, docker-compose.gpu.yml, and .env.docker.example for containerized deployment with GPU-enabled Ollama

## System Architecture

### Frontend (React + TypeScript)
The frontend delivers a rich interactive development environment with key components like a Workspace Header for navigation, a Monaco Editor for code editing, a File Tree for project navigation, and a Settings System for persistent configuration. It features an Encrypted Secrets Vault for secure storage, an AI Team Panel for task execution, and an AI Agents Panel for managing LLM backends. Other notable features include a Terminal Panel, Shell Panel, Diff Viewer, Database Panel for SQLite management, and a Command Palette for quick access to functionalities. The UI supports dark/light themes and project selection/management.

### Project Management System
Projects are stored in a `projects/` directory, each with isolated workspaces and metadata. An active project is tracked for session persistence, and all file system operations are scoped to the active project's directory. The system includes API endpoints for listing, creating, activating, and deleting projects, with robust security measures against path traversal.

### Backend (Express + TypeScript)
The backend provides API services for file system operations, AI orchestration, settings management, and data persistence. It includes a File System API, AI Orchestration for routing requests to configured agents, and APIs for Secrets Management and Database Management. A Task Runner manages AI task execution and artifact persistence, with an Ollama Integration for LLM backends and a Shell WebSocket Server for PTY-based shell sessions.

### AI Agents System
The system employs five role-based agents (Planner, Coder, Reviewer, TestFixer, Doc), each configurable with specific LLM backends, models, temperature, and context length. An Orchestrator routes AI requests, supporting a Fast/Accurate Toggle for dynamic model switching.

### Workflow Engine
The workflow engine supports Plan, Implement, Test, Review, and Verify task modes. It automates a sequence of Plan → Code → Apply → Test → Fix → Review, including file backups and test-fix retry loops. Workflow run metadata, step details, and artifacts are stored for traceability.

### Code Editing Reliability System
The code editing pipeline includes several reliability enhancements:
- **Repo Snapshot**: Captures file tree structure and target file contents for AI context.
- **Patch Validator**: Validates diffs before application, checking file existence, format, and preventing path traversal.
- **Enhanced Apply**: Supports standard file modifications, creation, and deletion via `git apply`.
- **Verify Step**: Runs configured test/build commands post-application.
- **TestFixer Retry Loop**: Automatically fixes failing tests with a retry mechanism, feeding failure logs to AI and applying generated fixes iteratively.

### Trust Hardening System
The system includes comprehensive trust hardening features for secure code changes:
- **Trust Settings**: Configurable limits in `.simpleaide/settings.json` for auto-fix, max attempts, max files/lines per patch, sensitive paths, and a verify allowlist.
- **Patch Safety Limits**: Blocks patches exceeding configured file and line limits.
- **Dangerous Change Detection**: Flags file deletions and sensitive path edits, requiring user confirmation.
- **Confirmation Token System**: Server-generated, time-limited nonce tokens for dangerous changes, requiring re-POST with a valid token for application.
- **Git Apply Hardening**: Uses `git apply --check` for dry runs and `--whitespace=nowarn`.
- **Verify Command Allowlist**: Executes only pre-approved commands or package.json scripts.
- **Enhanced Artifact Saving**: Saves detailed logs and reports for validation, applied files, verification, and blocked dangerous changes.
- **Settings UI**: Provides a user interface for configuring all safety limits.
- **Dangerous Change Dialog**: Displays clear warnings and requires explicit user confirmation for critical changes.

### Real-Time Agent Visibility System
A real-time agent activity monitoring system provides visibility into AI operations:
- **Agent Profiles Database**: SQLite tables store agent profiles and run events.
- **Event Emitter**: In-process pub/sub for real-time event broadcasting, dual-writing to the database and SSE broadcast.
- **Granular Event Emissions**: Emits detailed events for file operations, tool calls, changeset proposals, and progress tracking.
- **SSE Streaming Endpoint**: Server-Sent Events for real-time updates with heartbeat and reconnection support.
- **Agent Roster UI**: Visual agent cards with status indicators, color-coded avatars, and model badges.
- **Activity Timeline**: Real-time event feed with timestamping, event-type icons, and progress indicators.

### Security
Security measures include AES-256-GCM encryption for secrets, strict file permissions, path traversal prevention, environment detection (`SIMPLEAIDE_ENV`), and production environment restrictions (read-only database, disabled shell access).

## External Dependencies
- **Ollama**: Local LLM backend.
- **Monaco Editor**: Code editor.
- **TanStack Query**: Frontend data fetching and state management.
- **Tailwind CSS**: Utility-first CSS framework.
- **shadcn/ui**: UI component library.
- **Express.js**: Backend web framework.
- **React**: Frontend JavaScript library.
- **TypeScript**: For type safety.
- **Node.js**: JavaScript runtime environment.
- **SQLite**: Database engine.
- **Kaggle API**: For Kaggle services.
- **HuggingFace API**: For HuggingFace services.
- **NVIDIA NGC API**: For NVIDIA NGC services.