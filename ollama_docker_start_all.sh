#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load host port from .env.docker if available, default to 11439
OLLAMA_HOST_PORT="${OLLAMA_HOST_PORT:-11439}"
if [ -f ".env.docker" ]; then
    source <(grep -E '^OLLAMA_HOST_PORT=' .env.docker 2>/dev/null) || true
fi
OLLAMA_HOST_PORT="${OLLAMA_HOST_PORT:-11439}"

echo "=========================================="
echo "  SimpleAide Docker GPU Deployment"
echo "  Backend: Ollama"
echo "=========================================="
echo ""
echo "  Ollama container exposed on host port: $OLLAMA_HOST_PORT"
echo "  (Internal container port remains 11434)"
echo ""

# Check for .env.docker file
if [ ! -f ".env.docker" ]; then
    echo "[!] .env.docker not found!"
    echo "    Creating from template..."
    if [ -f ".env.docker.example" ]; then
        cp .env.docker.example .env.docker
        echo "    Created .env.docker from template."
        echo ""
        echo "[!] IMPORTANT: Edit .env.docker and set SESSION_SECRET"
        echo "    Generate one with: openssl rand -hex 32"
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

# Check for NVIDIA GPU (optional warning)
echo "[*] Checking GPU availability..."
if command -v nvidia-smi &> /dev/null; then
    echo "    GPU detected:"
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -1
else
    echo "    [!] nvidia-smi not found - GPU may not be available"
    echo "    The stack will still start, but Ollama may run on CPU"
fi
echo ""

# Build and start with Ollama profile
echo "[*] Building and starting containers (Ollama profile)..."
echo ""
docker compose -f docker-compose.gpu.yml --profile ollama up -d --build

echo ""
echo "[*] Waiting for services to be healthy..."
sleep 5

# Show status
echo ""
echo "[*] Container status:"
docker compose -f docker-compose.gpu.yml --profile ollama ps
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

echo ""
echo "=========================================="
echo "  Deployment Complete!"
echo "=========================================="
echo ""
echo "  App URL:     http://localhost:8521"
echo "  Ollama API:  http://localhost:$OLLAMA_HOST_PORT"
echo ""
echo "  Note: The app connects to Ollama internally via http://ollama:11434"
echo "        Host port $OLLAMA_HOST_PORT is for external/debugging access."
echo ""
echo "  Useful commands:"
echo "    View app logs:     docker logs -f simpleaide-app"
echo "    View Ollama logs:  docker logs -f simpleaide-ollama"
echo "    Pull more models:  docker exec -it simpleaide-ollama ollama pull <model>"
echo "    List models:       docker exec -it simpleaide-ollama ollama list"
echo "    Stop all:          ./ollama_docker_stop_all.sh"
echo ""
