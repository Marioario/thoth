#!/bin/bash
# Skill Evolution Hook Wrapper
# Analyzes git changes and suggests skill updates

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo "Installing hook dependencies..."
  npm install --silent
fi

# Run the TypeScript analysis
npx --yes tsx skill-evolution.ts
