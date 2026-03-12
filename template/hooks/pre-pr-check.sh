#!/bin/bash
#
# Pre-PR Check Hook
# Blocks `gh pr create` and requires /check-skills to be run first
#
# Hook type: PreToolUse (Bash matcher)
# Triggered: When Claude is about to run a Bash command
#
# IMPORTANT FOR CLAUDE:
# - Skills are located in .claude/skills/ directory (not frontend/src or backend/src)
# - Skill paths in skill-rules.json are RELATIVE to .claude/skills/
# - You MUST run /check-skills (Skill tool: skill="check-skills") BEFORE creating a PR
# - There are NO shortcuts or bypasses. You must complete the skill check first.
#

set -euo pipefail

# Read the hook input from stdin
INPUT=$(cat)

# Extract the command being run using jq for proper JSON parsing
# Falls back to empty string if jq fails or command field doesn't exist
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)

# Check if this is a PR creation command
if echo "$COMMAND" | grep -qE "gh pr create|gh pr --create"; then
  # Check for bypass flag in the command FIRST (before blocking)
  # The bypass must appear as a comment in the bash command, e.g.:
  #   gh pr create --title "..." # skip-skill-check
  if echo "$COMMAND" | grep -q "skip-skill-check"; then
    echo '{"continue": true}'
    exit 0
  fi

  # Use hookSpecificOutput format for more reliable blocking
  cat << 'HOOKEOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "⚠️ BLOCKED: You MUST run /check-skills before creating a PR.\n\nSTEP 1 (MANDATORY — do this NOW):\n  Use the Skill tool with skill=\"check-skills\"\n  Review the output and address any skill update suggestions.\n\nSTEP 2 (ONLY after completing Step 1):\n  Re-run your gh pr create command with '# skip-skill-check' appended as a bash comment.\n  Example: gh pr create --title \"...\" --body \"...\" # skip-skill-check\n\n⛔ DO NOT skip Step 1. DO NOT append '# skip-skill-check' without completing the skill check first.\n   Using the bypass without running /check-skills is a violation of project rules.\n   If you already ran /check-skills in this conversation, you may proceed to Step 2."
  }
}
HOOKEOF
  exit 0
fi

# Default: allow command to proceed without modification
echo '{"continue": true}'
