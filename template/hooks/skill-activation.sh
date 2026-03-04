#!/bin/bash
# Skill Auto-Activation Hook Wrapper
# Pipes stdin to TypeScript implementation via tsx

set -e

# Get the directory where this script lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Change to hooks directory and run TypeScript
cd "$SCRIPT_DIR"

# Check if node_modules exists, if not skip (first run)
if [ ! -d "node_modules" ]; then
  exit 0
fi

# Pipe stdin to tsx and let it process
cat | npx --yes tsx skill-activation.ts
