#!/usr/bin/env bash
set -euo pipefail

# Pre-commit hook to prevent accidental commits of runtime state and secrets
# Install: cp script/precommit-guard.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

FORBIDDEN_PATHS=(
  ".simpleaide"
  ".simpleide"
  "capsules.db"
  "capsules.db-wal"
  "capsules.db-shm"
  "secrets.enc"
  "agent-profiles.db"
)

echo "Checking for forbidden runtime files..."

for p in "${FORBIDDEN_PATHS[@]}"; do
  if git diff --cached --name-only | grep -q "^${p}"; then
    echo ""
    echo "ERROR: Attempting to commit forbidden runtime path: ${p}"
    echo "This path contains runtime state or secrets that should never be committed."
    echo ""
    echo "To fix:"
    echo "  git reset HEAD ${p}"
    echo "  echo '${p}' >> .gitignore"
    echo ""
    exit 1
  fi
done

echo "Pre-commit check passed."
