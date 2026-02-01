#!/bin/sh
set -e

BACKEND="${LLM_BACKEND:-ollama}"
BASE="${LLM_BASE_URL:-http://ollama:11434}"

echo "[entrypoint] LLM_BACKEND=$BACKEND"
echo "[entrypoint] Waiting for LLM at: $BASE"

# Pick a probe endpoint based on backend type
if [ "$BACKEND" = "vllm" ]; then
  PROBE="${BASE%/}/models"
else
  PROBE="${BASE%/}/api/version"
fi

echo "[entrypoint] Probing: $PROBE"

for i in $(seq 1 120); do
  if wget -qO- "$PROBE" >/dev/null 2>&1; then
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

exec node dist/server.js
