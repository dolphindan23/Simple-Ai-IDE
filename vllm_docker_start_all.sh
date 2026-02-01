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
echo "  Useful commands:"
echo "    View app logs:     docker logs -f simpleaide-app"
echo "    View vLLM logs:    docker logs -f simpleaide-vllm"
echo "    List models:       curl http://localhost:8000/v1/models"
echo "    Stop all:          ./vllm_docker_stop_all.sh"
echo ""
echo "  Note: vLLM uses HuggingFace model IDs. To change models,"
echo "        edit VLLM_MODEL in .env.docker and restart."
echo ""
