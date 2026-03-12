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
# - To run /check-skills, use the Skill tool with skill="check-skills"
# - To bypass this hook, add "# skip-skill-check" as a bash comment in your command
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
    "permissionDecisionReason": "⚠️ BLOCKED: Run /check-skills first before creating a PR.\n\nSteps:\n1. Use the Skill tool: skill=\"check-skills\"\n2. Review and address any skill update suggestions\n3. Then create the PR\n\nTo bypass (after running /check-skills): Include a bash comment with 'skip-skill-check' in your gh pr command.\n\nExample bypass:\n  gh pr create --title \"...\" --body \"...\" # skip-skill-check\n\nNOTE: Do NOT use --skip-skill-check as a CLI flag or environment variable. It must be a bash comment (after #)."
  }
}
HOOKEOF
  exit 0
fi

# Default: allow command to proceed without modification
echo '{"continue": true}'
