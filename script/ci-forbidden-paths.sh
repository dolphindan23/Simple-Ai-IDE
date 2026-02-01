#!/usr/bin/env bash
set -euo pipefail

# CI check to fail if runtime artifacts or secrets are tracked in git
# Usage: Run this in CI pipelines to catch accidental commits of runtime state

echo "Checking for forbidden tracked paths..."

FAILED=0

# Check for tracked runtime directories
for p in ".simpleaide" ".simpleide" "projects" "runs" "git-logs"; do
  if git ls-files | grep -q "^${p}/"; then
    echo "ERROR: tracked forbidden path: ${p}/"
    FAILED=1
  fi
done

# Check for tracked sqlite artifacts
if git ls-files | grep -Eq '\.db(-wal|-shm)?$'; then
  echo "ERROR: tracked sqlite artifact (*.db, *-wal, *-shm)"
  git ls-files | grep -E '\.db(-wal|-shm)?$' | head -10
  FAILED=1
fi

# Check for tracked secrets files
if git ls-files | grep -q 'secrets\.enc'; then
  echo "ERROR: tracked secrets file (secrets.enc)"
  FAILED=1
fi

if [ "$FAILED" -eq 1 ]; then
  echo ""
  echo "FAILED: Found forbidden tracked runtime artifacts."
  echo "Run 'git rm --cached <path>' to remove them from tracking."
  exit 1
fi

echo "OK: no forbidden tracked runtime artifacts"
