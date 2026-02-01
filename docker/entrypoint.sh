#!/bin/sh
set -e

BACKEND="${LLM_BACKEND:-ollama}"

# Auto-resolve base URL if not explicitly set
if [ -z "$LLM_BASE_URL" ]; then
  if [ "$BACKEND" = "vllm" ]; then
    BASE="http://vllm:8000/v1"
  else
    BASE="http://ollama:11434"
  fi
else
  BASE="$LLM_BASE_URL"
fi

echo "[entrypoint] LLM_BACKEND=$BACKEND"
echo "[entrypoint] Waiting for LLM at: $BASE"

# Pick a probe endpoint based on backend type
# vLLM: /v1/models (base URL should include /v1)
# Ollama: /api/version
if [ "$BACKEND" = "vllm" ]; then
  PROBE="${BASE%/}/models"
else
  PROBE="${BASE%/}/api/version"
fi

echo "[entrypoint] Probing: $PROBE"

# Use Node's built-in fetch (available in Node 20+) instead of wget/curl
# which may not be installed in slim images
for i in $(seq 1 120); do
  if node -e "fetch('$PROBE').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))" 2>/dev/null; then
    echo "[entrypoint] LLM is up."
    break
  fi
  if [ "$i" -eq 120 ]; then
    echo "[entrypoint] WARNING: LLM backend did not respond after 120 seconds. Starting anyway..."
  else
    echo "[entrypoint] not ready yet ($i/120) ..."
    sleep 1
  fi
done

exec npm run start
