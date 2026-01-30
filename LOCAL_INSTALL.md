# SimpleAide Local Installation Guide

This guide covers how to install and run SimpleAide on your local machine.

## Prerequisites

- **Node.js 20+** (required for native fetch support)
- **npm** (comes with Node.js)
- **Git** (required for patch application in trust hardening system)
- **Python 3** (required for building native modules)
- **Build tools** (required for better-sqlite3):
  - macOS: Xcode Command Line Tools
  - Linux: `build-essential` (gcc, g++, make)
  - Windows: Visual Studio Build Tools

## Quick Start

### 1. Install Prerequisites

**macOS:**
```bash
# Install Xcode Command Line Tools (includes Python, make, git)
xcode-select --install

# Install Node.js 20+ using Homebrew
brew install node@20
```

**Ubuntu/Debian:**
```bash
# Install build tools, Python, and Git
sudo apt-get update
sudo apt-get install -y build-essential python3 git

# Install Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Windows:**
1. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)
   - Select "Desktop development with C++" workload
2. Install [Python 3](https://www.python.org/downloads/) (check "Add to PATH")
3. Install [Git for Windows](https://git-scm.com/download/win)
4. Install [Node.js 20+](https://nodejs.org/) (LTS version)

**Verify installation:**
```bash
node --version   # Should show v20.x.x or higher
npm --version
git --version    # Required for patch application
python3 --version # Or 'python --version' on Windows
```

### 2. Clone or Download the Project

```bash
git clone <repository-url>
cd simpleaide
```

### 3. Install Dependencies

```bash
npm install
```

> **Note:** The `better-sqlite3` package requires native compilation. If you encounter build errors, ensure you have the build tools installed (see Prerequisites).

### 4. Run the Application

```bash
npm run dev
```

The application will start on **http://localhost:5000** (when running on Replit) or **http://localhost:8521** (local development).

You can override the port using the `PORT` environment variable:
```bash
PORT=3000 npm run dev
```

## Project Structure

```
simpleaide/
├── client/                 # React frontend (Vite)
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── hooks/          # React hooks (including SSE for real-time events)
│   │   ├── pages/          # Page components
│   │   └── lib/            # Utilities
│   └── public/             # Static assets
├── server/                 # Express backend
│   ├── aiDb.ts             # Agent profiles & run events database
│   ├── aiEvents.ts         # Real-time event emitter (SSE)
│   ├── routes.ts           # API endpoints
│   ├── taskRunner.ts       # AI task execution
│   ├── autoRunner.ts       # Autonomous workflow engine
│   ├── patchValidator.ts   # Patch safety validation
│   └── secrets.ts          # Encrypted secrets vault
├── shared/                 # Shared TypeScript types
│   └── schema.ts           # Zod schemas and types
├── .simpleaide/            # Runtime data directory (auto-created)
│   ├── settings.json       # User preferences and trust settings
│   ├── secrets.enc         # Encrypted secrets vault
│   ├── ai.db               # SQLite database for agent profiles/runs
│   └── runs/               # Workflow run artifacts
└── package.json
```

## Runtime Data Directory (.simpleaide/)

SimpleAide stores all runtime data in the `.simpleaide/` directory:

| File | Description |
|------|-------------|
| `settings.json` | User preferences, editor settings, trust limits |
| `secrets.enc` | AES-256-GCM encrypted secrets vault |
| `ai.db` | SQLite database for agent profiles, runs, and events |
| `runs/` | Workflow run artifacts and logs |

This directory is auto-created on first run. Add it to `.gitignore` to avoid committing sensitive data.

## Docker Installation (Optional)

SimpleAide can be deployed using Docker with optional GPU support for Ollama.

### Quick Start (Basic Docker)

```bash
# Build and run
docker build -t simpleaide .
docker run -p 8521:8521 -v simpleaide-data:/app/data simpleaide
```

### Docker Compose with GPU-Enabled Ollama

For a complete deployment with GPU-accelerated Ollama, use the included `docker-compose.gpu.yml`:

#### Prerequisites (NVIDIA GPU Host)

1. **NVIDIA drivers installed** (verify with `nvidia-smi`)
2. **Docker + Docker Compose v2** installed
3. **NVIDIA Container Toolkit** installed:

```bash
# Ubuntu/Debian
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
| sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
| sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

sudo apt update
sudo apt install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

**Verify GPU passthrough:**
```bash
docker run --rm --gpus all nvidia/cuda:12.3.2-base-ubuntu22.04 nvidia-smi
```

#### Setup & Run

1. **Create environment file:**
```bash
cp .env.docker.example .env.docker

# Edit .env.docker and set:
# - SESSION_SECRET (required - generate with: openssl rand -hex 32)
# - OLLAMA_MODEL (default: qwen2.5:7b)
```

2. **Start the stack:**
```bash
docker compose -f docker-compose.gpu.yml up -d --build
```

3. **Check status:**
```bash
docker compose -f docker-compose.gpu.yml ps
docker logs -f simpleaide-app
docker logs -f simpleaide-ollama
```

4. **Verify GPU access in Ollama:**
```bash
docker exec -it simpleaide-ollama nvidia-smi
docker exec -it simpleaide-ollama ollama list
```

5. **Access the app:**
   - Open http://localhost:8521 in your browser

#### Pull Additional Models

```bash
# Pull models into the Ollama container
docker exec -it simpleaide-ollama ollama pull codellama
docker exec -it simpleaide-ollama ollama pull qwen2.5:14b

# List available models
docker exec -it simpleaide-ollama ollama list
```

#### GPU Pinning (Multi-GPU Systems)

To use a specific GPU, add to the `ollama` service in `docker-compose.gpu.yml`:

```yaml
environment:
  - CUDA_VISIBLE_DEVICES=0   # Use GPU 0 only
```

For multiple Ollama instances (one per GPU), duplicate the `ollama` service with different:
- Container names (`simpleaide-ollama-0`, `simpleaide-ollama-1`)
- `CUDA_VISIBLE_DEVICES` values
- Volume names (`ollama_data_0`, `ollama_data_1`)
- Ports if exposing to host

#### Stop the Stack

```bash
docker compose -f docker-compose.gpu.yml down

# To also remove volumes (data will be lost):
docker compose -f docker-compose.gpu.yml down -v
```

### docker-compose.gpu.yml Reference

The GPU compose file includes:

| Service | Description |
|---------|-------------|
| `app` | SimpleAide Node.js application on port 8521 |
| `ollama` | GPU-enabled Ollama server with health checks |
| `ollama-init` | One-time model puller (pulls OLLAMA_MODEL on startup) |

| Volume | Description |
|--------|-------------|
| `ollama_data` | Persisted Ollama models and configuration |
| `simpleaide_config` | Application config and runtime data (.simpleaide directory) |
| `simpleaide_projects` | User projects |

**Note:** GPU access uses `runtime: nvidia` which requires the NVIDIA Container Toolkit to be properly configured. If you get GPU errors, verify with:
```bash
docker run --rm --runtime=nvidia nvidia/cuda:12.3.2-base-ubuntu22.04 nvidia-smi
```

### Dockerfile Reference

The included `Dockerfile` uses a multi-stage build:

1. **Build stage**: Compiles TypeScript and builds the application
2. **Runtime stage**: Minimal production image with only necessary files

Key features:
- Node 20 (bookworm-slim base)
- Native module support (better-sqlite3)
- Health check endpoint (`/api/status`)
- Runs on port 8521 by default

## Configuration

### Secrets Vault

SimpleAide includes an encrypted secrets vault for storing API keys:

1. Open Settings (gear icon)
2. Go to the Security/Vault tab
3. Create a vault with a master password (min 8 characters)
4. Add your API keys:
   - `KAGGLE_API_KEY` - For Kaggle integration
   - `HUGGINGFACE_TOKEN` - For HuggingFace integration
   - `NGC_API_KEY` - For NVIDIA NGC integration

The vault uses AES-256-GCM encryption with PBKDF2 key derivation.

### Trust Settings

Configure code editing safety limits in Settings > Trust:

| Setting | Default | Description |
|---------|---------|-------------|
| Auto-fix enabled | OFF | Allow TestFixer to auto-apply fixes |
| Max fix attempts | 3 | Maximum retry attempts for TestFixer |
| Max files per patch | 10 | Block patches affecting too many files |
| Max lines per patch | 500 | Block patches with too many line changes |
| Sensitive paths | server/**, .env* | Paths requiring confirmation |
| Verify allowlist | npm test, etc. | Commands allowed for verification |

### Ollama (AI Backend)

For AI features, install and configure Ollama:

1. Install Ollama: https://ollama.ai
2. Pull a code model:
   ```bash
   ollama pull codellama
   ```
3. Start Ollama:
   ```bash
   ollama serve
   ```
4. Configure in SimpleAide Settings > AI tab

The default Ollama endpoint is `http://localhost:11434`.

### AI Agents

SimpleAide includes 5 specialized AI agents:

| Agent | Role | Description |
|-------|------|-------------|
| Planner | 📋 | Plans implementation steps and architecture |
| Coder | 💻 | Writes and modifies code |
| Reviewer | 🔍 | Reviews code changes for quality |
| TestFixer | 🧪 | Runs tests and fixes failures |
| Doc | 📝 | Generates documentation |

Configure agent settings (model, temperature, context length) in Settings > AI Agents.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 5000 (Replit) / 8521 (local) |
| `NODE_ENV` | Environment mode | development |
| `SIMPLEAIDE_ENV` | Override environment detection | (uses NODE_ENV) |

### Ollama Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `OLLAMA_BASE_URL` | Ollama server URL | `http://localhost:11434` |
| `OLLAMA_MODEL` | Default model name | `codellama` |
| `OLLAMA_CONNECT_TIMEOUT_MS` | Connection timeout (ms) | `5000` |
| `OLLAMA_REQUEST_TIMEOUT_MS` | Request timeout for generation (ms) | `300000` (5 min) |
| `OLLAMA_RETRY_COUNT` | Number of retry attempts | `1` |
| `OLLAMA_RETRY_BACKOFF_MS` | Backoff between retries (ms) | `250` |
| `OLLAMA_PROVIDERS_JSON` | JSON array of providers (see below) | (not set) |

#### Multi-Provider Configuration

For headless deployments or multi-GPU setups, use `OLLAMA_PROVIDERS_JSON` to configure multiple Ollama backends:

```bash
export OLLAMA_PROVIDERS_JSON='[
  {"id":"coding-fast","url":"http://gpu-serv:11435","defaultModel":"qwen2.5:3b"},
  {"id":"coding-heavy","url":"http://gpu-serv:11436","defaultModel":"qwen2.5:7b"},
  {"id":"local","url":"http://127.0.0.1:11434","defaultModel":"codellama"}
]'
```

The app will use these providers and make them available for agent role assignments.

### Production Mode

Set `SIMPLEAIDE_ENV=production` (or `prod`) to enable:
- Read-only database (blocks INSERT/UPDATE/DELETE)
- Shell access disabled
- Enhanced security restrictions

```bash
SIMPLEAIDE_ENV=production npm start
```

## Security Notes

- The secrets vault file (`.simpleaide/secrets.enc`) has 0600 permissions
- The vault auto-locks after 15 minutes of inactivity (configurable)
- Never commit `.simpleaide/` to version control
- Git is required for the trust hardening patch application system
- Dangerous changes (file deletions, sensitive path edits) require confirmation

## Troubleshooting

### Port already in use
```bash
# Find process using the port
lsof -i :8521  # or :5000

# Kill it or use a different port
PORT=3000 npm run dev
```

### Node version too old
```bash
# Use nvm to manage Node versions
nvm install 20
nvm use 20
```

### better-sqlite3 build errors
```bash
# Ensure build tools are installed
# macOS:
xcode-select --install

# Ubuntu/Debian:
sudo apt-get install build-essential python3

# Windows: Install Visual Studio Build Tools

# Then rebuild
npm rebuild better-sqlite3
```

### Git not found (patch application fails)
```bash
# Install Git
# macOS: xcode-select --install (or brew install git)
# Ubuntu: sudo apt-get install git
# Windows: Download from git-scm.com
```

### Permissions issues on secrets file
```bash
# Fix permissions (Unix/macOS)
chmod 600 .simpleaide/secrets.enc
chmod 700 .simpleaide/
```

### SSE connection issues
If the Activity Timeline doesn't update in real-time:
- Check browser console for WebSocket/SSE errors
- The system falls back to polling automatically
- Ensure `/api/ai/stream` endpoint is accessible

## Testing AI Visibility System

SimpleAide includes tools for verifying the real-time agent visibility pipeline.

### Automated Smoke Test

Run the visibility smoke test to validate all event types fire correctly:

```bash
# With server already running:
node script/smoke-ai-visibility.mjs

# Or auto-start server:
START_SERVER=1 node script/smoke-ai-visibility.mjs
```

The smoke test:
1. Connects to the SSE stream (`/api/ai/stream`)
2. Triggers a task (default: implement mode)
3. Validates required events arrive (mode-aware):

**Implement mode** (default - full pipeline test):
- `READ_FILE` (during snapshot capture)
- `WRITE_FILE` (when patch applied)
- `TOOL_CALL` (verification commands)
- `PROPOSE_CHANGESET` (when diff generated)
- `AGENT_STATUS` with `done` status
- `STEP` with progress fields

**Plan mode** (lighter, non-mutating):
- `READ_FILE` (during snapshot capture)
- `AGENT_STATUS` with `done` status
- `STEP` with progress fields

Environment overrides:
```bash
BASE_URL=http://localhost:5000
MODE=implement
GOAL="Your test goal"
TIMEOUT_MS=60000
```

### Manual Curl Tests

**Check agent profiles (validates schema + typing):**
```bash
curl -s http://localhost:5000/api/ai/agent-profiles | jq .
```
Should show: `model`, `max_context_tokens`, `default_temperature`, `tools_enabled`, `system_prompt`, `enabled`.

**SSE stream (validates real-time updates):**
```bash
curl -N http://localhost:5000/api/ai/stream
```
Expected output:
- Initial snapshot event
- Periodic heartbeat
- Live events during runs

**Trigger a test run:**
```bash
curl -s -X POST http://localhost:5000/api/task/start \
  -H "Content-Type: application/json" \
  -d '{"goal":"SMOKE: trivial change + verify","mode":"implement","repoPath":"'"$PWD"'"}' | jq .
```

While running, the SSE stream should show:
- `AGENT_STATUS` with `status:"done"`
- `READ_FILE` events
- `WRITE_FILE` events
- `TOOL_CALL` events
- `PROPOSE_CHANGESET` events
- `STEP` events with progress fields

### UI Verification

After a run completes:
1. Refresh the page - timeline should rehydrate from stored events
2. Agent roster shows correct final statuses (including "done")
3. Model badges render correctly on agent cards
4. Progress indicators show `[phase] step X/Y` format

## Building for Production

```bash
# Build the application
npm run build

# Start production server
npm start
```

The production build outputs to `dist/` and serves static files from `server/public/`.

## License

See LICENSE file in the repository.
