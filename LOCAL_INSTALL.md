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

### Docker Compose with GPU-Enabled LLM Backend

SimpleAide supports two GPU-accelerated LLM backends via Docker Compose profiles:
- **Ollama** (default) - Easy model management, pull-and-run workflow
- **vLLM** - OpenAI-compatible API, faster inference, better for production

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

#### Option A: Ollama Backend (Recommended for Getting Started)

1. **Create environment file:**
```bash
cp .env.docker.example .env.docker

# Edit .env.docker and set:
# - LLM_BACKEND=ollama (default)
# - OLLAMA_MODEL (default: qwen2.5:7b)
```

2. **Start with Ollama profile:**
```bash
docker compose -f docker-compose.gpu.yml --profile ollama up -d --build
```

#### Option B: vLLM Backend (Recommended for Production)

vLLM provides an OpenAI-compatible API with faster inference and better GPU utilization.

1. **Create environment file:**
```bash
cp .env.docker.example .env.docker

# Edit .env.docker and set:
LLM_BACKEND=vllm
LLM_BASE_URL=http://vllm:8000/v1
LLM_MODEL=Qwen/Qwen2.5-7B-Instruct
VLLM_MODEL=Qwen/Qwen2.5-7B-Instruct
VLLM_DTYPE=float16
VLLM_MAX_MODEL_LEN=8192
```

2. **Start with vLLM profile:**
```bash
docker compose -f docker-compose.gpu.yml --profile vllm up -d --build
```

**Note:** vLLM cold start can take 1-3 minutes as it downloads and loads the model. The app will wait up to 2 minutes for the backend to become available.

**Recommended vLLM Models:**
- `Qwen/Qwen2.5-7B-Instruct` - Good balance of speed and quality
- `Qwen/Qwen2.5-14B-Instruct` - Higher quality, needs more VRAM
- `codellama/CodeLlama-7b-Instruct-hf` - Code-focused
- `mistralai/Mistral-7B-Instruct-v0.3` - Fast general purpose

**Model Naming Note:** vLLM reports the model ID via `/v1/models` which must match `LLM_MODEL`. By default, vLLM uses the HuggingFace repo ID (e.g., `Qwen/Qwen2.5-7B-Instruct`). For stable/friendly names, add `--served-model-name my-model` to the vLLM command in `docker-compose.gpu.yml` and set `LLM_MODEL=my-model`.

#### Verify Deployment (Smoke Tests)

After starting either profile, run these commands to verify:

**Ollama Profile:**
```bash
# Check Ollama is responding (default host port: 11439)
curl -s http://localhost:11439/api/version | jq .

# List available models
curl -s http://localhost:11439/api/tags | jq '.models[].name'

# Check app is responding
curl -s http://localhost:8521/api/status | jq .

# Test Ollama chat completion
curl -s http://localhost:11439/api/chat -d '{
  "model": "qwen2.5:7b",
  "messages": [{"role": "user", "content": "Say hello in 5 words."}],
  "stream": false
}' | jq -r '.message.content'
```

**vLLM Profile:**
```bash
# Check vLLM is responding (base URL includes /v1)
curl -s http://localhost:8000/v1/models | jq '.data[].id'

# Check app is responding
curl -s http://localhost:8521/api/status | jq .

# Test vLLM chat completion
curl -s http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen2.5-7B-Instruct",
    "messages": [{"role":"user","content":"Say hello in 5 words."}],
    "temperature": 0.2
  }' | jq -r '.choices[0].message.content'
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

**Ollama Profile:**
```bash
# Use the convenience script
./ollama_docker_stop_all.sh

# Or manual command
docker compose -f docker-compose.gpu.yml --profile ollama down

# To also remove volumes (data will be lost):
./ollama_docker_stop_all.sh --clean
```

**vLLM Profile:**
```bash
# Use the convenience script
./vllm_docker_stop_all.sh

# Or manual command
docker compose -f docker-compose.gpu.yml --profile vllm down

# To also remove volumes (data will be lost):
./vllm_docker_stop_all.sh --clean
```

### docker-compose.gpu.yml Reference

The GPU compose file uses Compose profiles to select the LLM backend:

| Service | Profile | Description |
|---------|---------|-------------|
| `app` | (always) | SimpleAide Node.js application on port 8521 |
| `ollama` | `ollama` | GPU-enabled Ollama server with health checks |
| `ollama-init` | `ollama` | One-time model puller (pulls OLLAMA_MODEL on startup) |
| `vllm` | `vllm` | GPU-enabled vLLM OpenAI-compatible server |

| Volume | Description |
|--------|-------------|
| `ollama_data` | Persisted Ollama models and configuration |
| `vllm_hf_cache` | Persisted HuggingFace model cache for vLLM |
| `simpleaide_data` | Application config and runtime data (.simpleaide directory) |
| `simpleaide_projects` | User projects |

**Notes:**
- Use `--profile ollama` or `--profile vllm` to select the backend
- GPU access uses `deploy.resources.reservations.devices` for modern Compose
- The app includes a wait-for-LLM entrypoint that polls the backend before starting
- vLLM cold starts can take 1-3 minutes; ensure sufficient VRAM (8GB+ for 7B models)
- If you get GPU errors, verify with:
```bash
docker run --rm --gpus all nvidia/cuda:12.3.2-base-ubuntu22.04 nvidia-smi
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

The default Ollama endpoint is `http://localhost:11434` (native install) or `http://localhost:11439` (Docker container).

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

### LLM Backend Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_BACKEND` | Backend type: `ollama` or `vllm` | `ollama` |
| `LLM_BASE_URL` | LLM server URL | (auto-resolved based on backend) |
| `LLM_MODEL` | Model name | (auto-resolved based on backend) |

### Ollama Port Configuration (Docker)

By default, SimpleAide runs the Ollama Docker container on host port **11439**.

This avoids conflicts with native Ollama installations, which typically bind to **11434**.

| Component | Address |
|-----------|---------|
| Host access (debugging) | `http://localhost:11439` |
| Internal Docker access (used by app) | `http://ollama:11434` |
| Native Ollama (if installed) | `http://localhost:11434` |

To change the host port, edit `OLLAMA_HOST_PORT` in `.env.docker`.

### Ollama Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `OLLAMA_HOST_PORT` | Host port for Ollama container | `11439` |
| `OLLAMA_BASE_URL` | Ollama server URL | `http://localhost:11434` (native) |
| `OLLAMA_MODEL` | Default model name | `qwen2.5:7b` |
| `OLLAMA_CONNECT_TIMEOUT_MS` | Connection timeout (ms) | `5000` |
| `OLLAMA_REQUEST_TIMEOUT_MS` | Request timeout for generation (ms) | `300000` (5 min) |
| `OLLAMA_RETRY_COUNT` | Number of retry attempts | `1` |
| `OLLAMA_RETRY_BACKOFF_MS` | Backoff between retries (ms) | `250` |
| `OLLAMA_PROVIDERS_JSON` | JSON array of providers (see below) | (not set) |

### vLLM / OpenAI-Compatible Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `HF_TOKEN` | HuggingFace access token (for gated models) | (not set) |
| `VLLM_MODEL` | HuggingFace model ID | `Qwen/Qwen2.5-7B-Instruct` |
| `VLLM_DTYPE` | Inference data type | `float16` |
| `VLLM_MAX_MODEL_LEN` | Maximum context length | `8192` |
| `OPENAI_API_KEY` | API key for remote OpenAI-compat servers | (not set) |
| `OPENAI_ORG_ID` | OpenAI organization ID | (not set) |
| `OPENAI_PROJECT_ID` | OpenAI project ID | (not set) |

#### HuggingFace Token (for Gated Models)

Many popular models (Llama, Mistral, Gemma, etc.) are "gated" on HuggingFace and require authentication to download.

**To get a token:**
1. Create an account at [huggingface.co](https://huggingface.co)
2. Go to [Settings > Access Tokens](https://huggingface.co/settings/tokens)
3. Create a token with **Read** access
4. Accept the model license on the model's HuggingFace page

**To use the token:**
- Add `HF_TOKEN=hf_xxxxx` to `.env.docker`, OR
- Run `./vllm_docker_start_all.sh` and it will prompt you (input is hidden)

**Never commit `.env.docker` to version control.**

#### vLLM CUDA Compatibility

vLLM requires a CUDA/PyTorch build that supports your GPU's compute capability.

If you see errors like:
```
CUDA capability mismatch: supported (8.0)-(12.0), found 12.1
```

This means the vLLM Docker image doesn't support your GPU architecture yet. Options:
- **Use Ollama backend instead** (more hardware-compatible)
- **Pin to a specific vLLM image** that matches your CUDA stack
- **Wait for vLLM updates** that support newer compute capabilities

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
