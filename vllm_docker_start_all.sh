#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "  SimpleAide Docker GPU Deployment"
echo "  Backend: vLLM"
echo "=========================================="
echo ""

# Check for .env.docker file
if [ ! -f ".env.docker" ]; then
    echo "[!] .env.docker not found!"
    echo "    Creating from template..."
    if [ -f ".env.docker.example" ]; then
        cp .env.docker.example .env.docker
        chmod 600 .env.docker 2>/dev/null || true
        echo "    Created .env.docker from template."
        echo ""
        echo "[!] IMPORTANT: Edit .env.docker and configure:"
        echo "    - SESSION_SECRET (generate with: openssl rand -hex 32)"
        echo "    - LLM_BACKEND=vllm"
        echo "    - VLLM_MODEL (HuggingFace model ID)"
        echo ""
        read -p "Press Enter to continue after editing .env.docker, or Ctrl+C to abort..."
    else
        echo "[!] .env.docker.example not found. Please create .env.docker manually."
        exit 1
    fi
fi

# Ensure .env.docker has secure permissions
chmod 600 .env.docker 2>/dev/null || true

# Load .env.docker safely
set -a
source .env.docker 2>/dev/null || true
set +a

# Prompt for HuggingFace token if not set
if [ -z "${HF_TOKEN:-}" ]; then
    echo ""
    echo "[!] HuggingFace token not set (HF_TOKEN)."
    echo "    Some models are gated and require authentication to download."
    echo "    Get a token: https://huggingface.co/settings/tokens (Read access)"
    echo ""
    read -r -s -p "Enter HF_TOKEN (leave blank to skip): " INPUT_HF_TOKEN
    echo ""

    if [ -n "$INPUT_HF_TOKEN" ]; then
        read -r -p "Save token to .env.docker for future runs? (Y/n): " SAVE_TOKEN
        SAVE_TOKEN="${SAVE_TOKEN:-Y}"
        
        if [[ "$SAVE_TOKEN" =~ ^[Yy]$ ]] || [ -z "$SAVE_TOKEN" ]; then
            # Write/update .env.docker
            if grep -q '^HF_TOKEN=' .env.docker; then
                sed -i "s/^HF_TOKEN=.*/HF_TOKEN=${INPUT_HF_TOKEN}/" .env.docker
            else
                echo "HF_TOKEN=${INPUT_HF_TOKEN}" >> .env.docker
            fi
            chmod 600 .env.docker 2>/dev/null || true
            echo "[+] Saved HF_TOKEN to .env.docker"
        else
            echo "[*] Token will be used for this session only (not saved)"
        fi
        export HF_TOKEN="$INPUT_HF_TOKEN"
    else
        echo "[!] Continuing without HF_TOKEN. Gated models may fail to download."
    fi
fi

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo "[!] Docker is not installed. Please install Docker first."
    exit 1
fi

# Check for Docker Compose
if ! docker compose version &> /dev/null; then
    echo "[!] Docker Compose v2 is not available."
    echo "    Please install Docker Compose v2 or update Docker."
    exit 1
fi

# Check for NVIDIA GPU
echo "[*] Checking GPU availability..."
if command -v nvidia-smi &> /dev/null; then
    echo "    GPU detected:"
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -1
else
    echo "    [!] nvidia-smi not found - GPU is required for vLLM!"
    echo "    vLLM requires NVIDIA GPU with CUDA support."
    exit 1
fi
echo ""

# Build and start with vLLM profile
echo "[*] Building and starting containers (vLLM profile)..."
echo "[*] Note: vLLM cold start can take 1-3 minutes for model loading."
echo ""
docker compose -f docker-compose.gpu.yml --profile vllm up -d --build

echo ""
echo "[*] Waiting for vLLM to load model (this may take a few minutes)..."

# Extended wait for vLLM - it needs time to download/load models
for i in {1..60}; do
    if curl -s http://localhost:8000/v1/models > /dev/null 2>&1; then
        echo "    vLLM is ready!"
        break
    fi
    if [ $i -eq 60 ]; then
        echo "    [!] vLLM still loading. Check logs with:"
        echo "        docker logs -f simpleaide-vllm"
    else
        echo "    Waiting for vLLM... ($i/60)"
        sleep 5
    fi
done

# Show status
echo ""
echo "[*] Container status:"
docker compose -f docker-compose.gpu.yml --profile vllm ps
echo ""

# Check if app is responding
echo "[*] Checking app health..."
for i in {1..10}; do
    if curl -s http://localhost:8521/health > /dev/null 2>&1; then
        echo "    App is healthy!"
        break
    fi
    if [ $i -eq 10 ]; then
        echo "    [!] App health check timed out. Check logs with:"
        echo "        docker logs -f simpleaide-app"
    fi
    sleep 2
done

# Show available models
echo ""
echo "[*] Available vLLM models:"
curl -s http://localhost:8000/v1/models 2>/dev/null | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "    (Unable to fetch models)"

echo ""
echo "=========================================="
echo "  Deployment Complete!"
echo "=========================================="
echo ""
echo "  App URL:     http://localhost:8521"
echo "  vLLM API:    http://localhost:8000/v1"
echo ""
echo "  Self-test commands:"
echo "    curl -s http://localhost:8000/v1/models | jq '.data | length'"
echo "    curl -s http://localhost:8521/api/status | jq"
echo ""
echo "  Useful commands:"
echo "    View app logs:     docker logs -f simpleaide-app"
echo "    View vLLM logs:    docker logs -f simpleaide-vllm"
echo "    List models:       curl http://localhost:8000/v1/models"
echo "    Stop all:          ./vllm_docker_stop_all.sh"
echo ""
echo "  Note: vLLM uses HuggingFace model IDs. To change models,"
echo "        edit VLLM_MODEL in .env.docker and restart."
echo ""
echo "  Troubleshooting:"
echo "    - If model download fails with 401/403: Set HF_TOKEN and ensure"
echo "      you've accepted the model license on huggingface.co"
echo "    - If you see CUDA capability mismatch: Change VLLM_IMAGE in"
echo "      .env.docker to a build that supports your GPU, or use Ollama."
echo "    - If OOM errors: Lower VLLM_GPU_MEMORY_UTILIZATION (default 0.75)"
echo "      or VLLM_MAX_MODEL_LEN in .env.docker"
echo ""
