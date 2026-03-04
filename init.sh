#!/bin/bash
#
# Thoth - Living knowledge for your codebase
#
# Sets up the Thoth skill system in the current repository.
#
# Usage:
#   cd /path/to/your-repo
#   bash /path/to/thoth/init.sh           # Full install
#   bash /path/to/thoth/init.sh --update  # Update engine only
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/template"
UPDATE_ONLY=false

# Parse flags
for arg in "$@"; do
  case $arg in
    --update) UPDATE_ONLY=true; shift ;;
    *) break ;;
  esac
done

TARGET_DIR="${1:-.}"
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$UPDATE_ONLY" = true ]; then
  echo "𓁟 Thoth — Update"
else
  echo "𓁟 Thoth — Setup"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Target: $TARGET_DIR"
echo ""

if [ ! -d "$TEMPLATE_DIR" ]; then
  echo "❌ Template directory not found at $TEMPLATE_DIR"
  exit 1
fi

# Step 1: Create .claude directory structure
echo "📁 Creating .claude directory structure..."
mkdir -p "$TARGET_DIR/.claude/hooks"
mkdir -p "$TARGET_DIR/.claude/skills"
mkdir -p "$TARGET_DIR/.claude/commands"

# Step 2: Copy engine files (always — these are the updatable parts)
echo "🔧 Installing engine..."
cp "$TEMPLATE_DIR/hooks/skill-activation.ts" "$TARGET_DIR/.claude/hooks/"
cp "$TEMPLATE_DIR/hooks/skill-activation.sh" "$TARGET_DIR/.claude/hooks/"
cp "$TEMPLATE_DIR/hooks/skill-evolution.ts" "$TARGET_DIR/.claude/hooks/"
cp "$TEMPLATE_DIR/hooks/skill-evolution.sh" "$TARGET_DIR/.claude/hooks/"
cp "$TEMPLATE_DIR/hooks/pre-pr-check.sh" "$TARGET_DIR/.claude/hooks/"
cp "$TEMPLATE_DIR/hooks/package.json" "$TARGET_DIR/.claude/hooks/"
cp "$TEMPLATE_DIR/hooks/.thoth-version" "$TARGET_DIR/.claude/hooks/"

chmod +x "$TARGET_DIR/.claude/hooks/"*.sh

if [ "$UPDATE_ONLY" = true ]; then
  # Update mode: only reinstall dependencies and stop
  echo "📦 Updating dependencies..."
  (cd "$TARGET_DIR/.claude/hooks" && npm install --silent 2>&1) || {
    echo "   ⚠️  npm install failed — run 'cd .claude/hooks && npm install' manually"
  }

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "✅ Thoth engine updated!"
  echo "   Your skill-rules.json and skill files were not modified."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
fi

# Step 3: Copy SKILL-AUTHORING.md
echo "📝 Installing skill authoring guide..."
cp "$TEMPLATE_DIR/skills/SKILL-AUTHORING.md" "$TARGET_DIR/.claude/skills/"

# Step 4: Copy skill-rules.json (skip if exists)
if [ -f "$TARGET_DIR/.claude/skills/skill-rules.json" ]; then
  echo "⏭️  skill-rules.json already exists — skipping (won't overwrite)"
else
  echo "📝 Installing starter skill-rules.json..."
  cp "$TEMPLATE_DIR/skills/skill-rules.starter.json" "$TARGET_DIR/.claude/skills/skill-rules.json"
fi

# Step 5: Copy commands
echo "📝 Installing commands..."
cp "$TEMPLATE_DIR/commands/check-skills.md" "$TARGET_DIR/.claude/commands/"

# Step 6: Merge hook entries into settings.json
echo "⚙️  Configuring hooks in settings.json..."

SETTINGS_FILE="$TARGET_DIR/.claude/settings.json"

HOOKS_JSON='{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/skill-activation.sh"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/pre-pr-check.sh"
          }
        ]
      }
    ]
  }
}'

if [ -f "$SETTINGS_FILE" ]; then
  if command -v jq &>/dev/null; then
    EXISTING=$(cat "$SETTINGS_FILE")
    MERGED=$(echo "$EXISTING" | jq --argjson hooks "$(echo "$HOOKS_JSON" | jq '.hooks')" '.hooks = $hooks')
    echo "$MERGED" > "$SETTINGS_FILE"
    echo "   Merged hooks into existing settings.json"
  else
    echo "   ⚠️  jq not found — cannot merge settings.json automatically"
    echo "   Please manually add the following hooks to $SETTINGS_FILE:"
    echo ""
    echo "$HOOKS_JSON"
    echo ""
  fi
else
  echo "$HOOKS_JSON" > "$SETTINGS_FILE"
  echo "   Created settings.json with hook configuration"
fi

# Step 7: Install hook dependencies
echo "📦 Installing dependencies..."
(cd "$TARGET_DIR/.claude/hooks" && npm install --silent 2>&1) || {
  echo "   ⚠️  npm install failed — run 'cd .claude/hooks && npm install' manually"
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Thoth installed!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps:"
echo ""
echo "  1. Edit .claude/skills/skill-rules.json"
echo "     - Replace the example domain with your project's domains"
echo "     - Add prompt triggers (keywords that activate skills)"
echo "     - Add file triggers (path patterns that activate skills)"
echo "     - Add evolution patterns (patterns to detect in changes)"
echo ""
echo "  2. Create your first skill file"
echo "     - mkdir -p .claude/skills/your-domain"
echo "     - See .claude/skills/SKILL-AUTHORING.md for the template"
echo ""
echo "  3. Test the system"
echo "     - Run: cd .claude/hooks && npx tsx skill-evolution.ts"
echo "     - Run: echo '{\"prompt\":\"your keyword\",\"session_id\":\"test\"}' | cd .claude/hooks && npx tsx skill-activation.ts"
echo ""
echo "  4. Commit the .claude/ directory to your repo"
echo ""
