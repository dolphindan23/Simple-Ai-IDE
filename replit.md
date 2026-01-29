# SimpleAide - AI-Powered Coding Workspace

## Overview
SimpleAide is an AI-powered coding workspace designed to streamline development with an AI-driven multi-agent workflow. It integrates a Monaco-based code editor, a file tree, a terminal, and an AI Team sidebar for generating plans, implementing code, running tests, and reviewing changes. The project aims to provide a minimal yet powerful IDE experience, leveraging AI to enhance developer productivity and accelerate software delivery.

## User Preferences
- Dark theme by default (IDE-focused design)
- JetBrains Mono font for code
- Diff-first workflow (agents propose changes, users apply)

## System Architecture

### Frontend (React + TypeScript)
The frontend provides a rich interactive development environment. Key components include:
- **Workspace Header**: A Replit-style tab bar for navigation between Editor, Preview, Database, Secrets, Console, Shell, Developer, and AI Agents panels.
- **Monaco Editor**: A professional code editor offering syntax highlighting, IntelliSense, and comprehensive editing functionalities.
- **File Tree**: A collapsible file explorer for project navigation and file operations (save, new file/folder, rename, delete, duplicate, copy path).
- **Settings System**: Persistent configuration managed via `.simpleaide/settings.json`, with dedicated tabs for General and Editor settings.
- **Encrypted Secrets Vault**: Secure storage for sensitive information like API keys, encrypted using AES-256-GCM and protected by a master password.
- **AI Team Panel**: A sidebar facilitating AI task execution (Plan, Implement, Test, Review) and displaying action cards with model/backend metadata.
- **AI Agents Panel**: Configuration interface for managing multiple LLM backends and assigning them to specialized roles (Planner, Coder, Reviewer, TestFixer, Doc), each with custom model settings.
- **Terminal Panel**: A resizable output panel with three states (expanded/collapsed/hidden) for displaying logs and command output.
- **Shell Panel**: Interactive PTY shell with xterm.js, featuring WebSocket-based communication, auto-resize, and reconnection support. Disabled in PROD mode for security.
- **Diff Viewer**: Integrated display for reviewing AI-generated code changes before application.
- **Database Panel**: UI for SQLite database management, including table viewing, inline editing, and SQL execution. Enforces read-only mode in PROD environment (blocks INSERT/UPDATE/DELETE/DROP/CREATE/ALTER/TRUNCATE).
- **Command Palette**: A quick-access interface (Ctrl+K) for searching files, switching tabs, initiating AI actions, and navigating settings.
- **Theme Provider**: Supports dark and light themes for the IDE.

### Backend (Express + TypeScript)
The backend provides API services for file system operations, AI orchestration, settings management, and data persistence.
- **File System API**: Endpoints for reading, writing, creating, renaming, deleting, and duplicating files and folders.
- **AI Orchestration**: Routes requests to configured AI agents based on roles, managing model configurations, and handling fallbacks.
- **Secrets Management**: APIs for creating, unlocking, locking, and managing encrypted secrets.
- **Database Management**: Endpoints for SQLite database operations, including listing databases, table schemas, row manipulation, and raw SQL execution.
- **Task Runner**: Manages the execution of AI tasks and persistence of task artifacts and runs.
- **Ollama Integration**: Adapter for interacting with Ollama-compatible LLM backends.
- **Shell WebSocket Server**: PTY-based shell sessions via WebSocket (/api/shell/ws) using node-pty for spawning pseudo-terminals.

### Shared Components
- **Schema**: TypeScript types and Zod schemas for ensuring data consistency between frontend and backend.

### AI Agents System
- **Role-Based Agents**: 5 specialized roles (Planner, Coder, Reviewer, TestFixer, Doc) can be configured with specific LLM backends, models, temperature, and context length.
- **Orchestrator**: Routes AI requests based on the agent's role configuration, defaulting to general settings or the first available backend if specific configurations are absent.
- **Fast/Accurate Toggle**: Allows dynamic switching between different AI model configurations for task execution.

### Workflow Engine
- **Task Modes**: Supports Plan, Implement, Test, and Review modes for structured AI interaction.
- **Autonomous Workflow**: Automates a sequence of Plan → Code → Apply → Test → Fix → Review, including file backups and test-fix retry loops for robust development.
- **Run Storage**: Stores workflow run metadata, step details, and artifacts in `.simpleaide/runs/` for traceability and re-execution.

### Security
- **Encryption**: AES-256-GCM for secrets with PBKDF2 for key derivation.
- **File Permissions**: Strict file permissions (0600) for sensitive files and backups.
- **Path Traversal Prevention**: Safeguards against directory traversal attacks.
- **Environment Detection**: SIMPLEAIDE_ENV overrides NODE_ENV for environment detection (supports "prod"/"production"). Status header shows both values for debugging.
- **PROD Restrictions**: Database is read-only in PROD (blocks all write operations). Shell access is disabled in PROD.

## External Dependencies
- **Ollama**: Local LLM (Large Language Model) backend for AI functionalities. Default `http://localhost:11434` with `codellama` model.
- **Monaco Editor**: Code editor component.
- **TanStack Query**: Data fetching and state management in the frontend.
- **Tailwind CSS**: Utility-first CSS framework for styling.
- **shadcn/ui**: UI component library.
- **Express.js**: Backend web application framework.
- **React**: Frontend JavaScript library.
- **TypeScript**: Superset of JavaScript for type safety.
- **Node.js**: JavaScript runtime environment (version 18+ recommended).
- **SQLite**: Database engine for project databases.
- **Kaggle API**: Integration for Kaggle services, requiring `KAGGLE_API_KEY`.
- **HuggingFace API**: Integration for HuggingFace services, requiring `HUGGINGFACE_TOKEN`.
- **NVIDIA NGC API**: Integration for NVIDIA NGC services, requiring `NGC_API_KEY`.