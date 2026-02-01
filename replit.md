# SimpleAide

## Overview

SimpleAide is an AI-powered code assistant and IDE built as a full-stack TypeScript application. It provides a web-based development environment with integrated AI capabilities for code generation, editing, and assistance through local LLM backends like Ollama.

The application features a Monaco-based code editor, terminal integration, file management, and configurable AI agent backends that can be connected to various LLM providers.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Build Tool**: Vite for development and production builds
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming
- **State Management**: TanStack React Query for server state
- **Code Editor**: Monaco Editor (@monaco-editor/react) for code editing
- **Terminal**: xterm.js for integrated terminal functionality
- **Forms**: React Hook Form with Zod validation (@hookform/resolvers)

### Backend Architecture
- **Runtime**: Node.js 20+ with native fetch support
- **Framework**: Express.js server
- **Language**: TypeScript with tsx for development execution
- **Build Output**: Compiled to CommonJS (dist/index.cjs) for production

### Data Storage
- **Primary Database**: PostgreSQL via Drizzle ORM
- **Local Storage**: better-sqlite3 for local/offline functionality
- **Schema Location**: shared/schema.ts (shared between client and server)
- **Migrations**: Managed via drizzle-kit with migrations stored in ./migrations

### Configuration System
- **User Settings**: JSON-based configuration stored in .simpleaide/settings.json
- **Model Catalog**: AI model configurations in .simpleaide/model_catalog.json
- **Settings Include**: Theme preferences, editor configuration, AI backend settings, integration toggles, and trust/security settings

### Trust & Security System
- Configurable trust settings for AI-generated patches
- Auto-fix capabilities with attempt limits
- File and line count limits per patch
- Sensitive path protection
- Git-based patch application system

## External Dependencies

### AI/LLM Integration
- **Ollama**: Primary local LLM backend (default: http://localhost:11434)
- **Supported Models**: CodeLlama and other Ollama-compatible models
- **Backend Configuration**: Multiple AI backends can be configured with different auth types (none, API key, etc.)

### Optional Integrations
- **Kaggle**: Dataset and notebook integration (configurable)
- **Hugging Face**: Model and dataset integration (configurable)
- **NGC (NVIDIA GPU Cloud)**: GPU-accelerated model integration (configurable)

### Database
- **PostgreSQL**: Required for production deployment (DATABASE_URL environment variable)
- **Drizzle ORM**: Type-safe database queries and schema management

### Build Requirements
- **Python 3**: Required for building native modules (better-sqlite3)
- **C++ Build Tools**: Platform-specific compilers for native dependencies
- **Git**: Required for patch application in trust hardening system