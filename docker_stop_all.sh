#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "  SimpleAide Docker Stop"
echo "=========================================="
echo ""

# Check for running containers
RUNNING=$(docker compose -f docker-compose.gpu.yml ps -q 2>/dev/null | wc -l)

if [ "$RUNNING" -eq 0 ]; then
    echo "[*] No containers are running."
    exit 0
fi

echo "[*] Current container status:"
docker compose -f docker-compose.gpu.yml ps
echo ""

# Determine if we should remove volumes
CLEAN_VOLUMES=false
if [ "$1" == "--clean" ] || [ "$1" == "-c" ]; then
    CLEAN_VOLUMES=true
fi

# Stop containers (with or without volume removal)
if [ "$CLEAN_VOLUMES" = true ]; then
    echo "[*] Stopping containers and removing volumes..."
    docker compose -f docker-compose.gpu.yml down -v
    echo ""
    echo "[*] Containers stopped and volumes removed."
else
    echo "[*] Stopping containers..."
    docker compose -f docker-compose.gpu.yml down
    echo ""
    echo "[*] Containers stopped."
    echo ""
    echo "  Note: Data volumes are preserved."
    echo "  To also remove all data (models, config, projects), run:"
    echo "    ./docker_stop_all.sh --clean"
fi

echo ""
echo "=========================================="
echo "  Shutdown Complete"
echo "=========================================="
echo ""
