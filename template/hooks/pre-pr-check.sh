#!/bin/bash
#
# Pre-PR Check Hook
# Blocks `gh pr create` until /check-skills and /self-review have been run
#
# Hook type: PreToolUse (Bash matcher)
# Triggered: When Claude is about to run a Bash command
#
# IMPORTANT FOR CLAUDE:
# - Skills are located in .claude/skills/ directory (not frontend/src or backend/src)
# - Skill paths in skill-rules.json are RELATIVE to .claude/skills/
# - You MUST run /check-skills (Skill tool: skill="check-skills") BEFORE creating a PR
# - You MUST run /self-review (Skill tool: skill="self-review") BEFORE creating a PR
# - There are NO shortcuts or bypasses. You must complete both checks first.
#

set -euo pipefail

# Read the hook input from stdin
INPUT=$(cat)

# Extract the command being run using jq for proper JSON parsing
# Falls back to empty string if jq fails or command field doesn't exist
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)

# Check if this is a PR creation command
if echo "$COMMAND" | grep -qE "gh pr create|gh pr --create"; then
  # Check for the completion marker in the command FIRST (before blocking)
  # The marker must appear as a comment in the bash command, e.g.:
  #   gh pr create --title "..." # pre-pr-checks-done
  # The old "skip-skill-check" marker is deliberately not accepted: sessions that remember it
  # would otherwise skip /self-review.
  if echo "$COMMAND" | grep -q "pre-pr-checks-done"; then
    echo '{"continue": true}'
    exit 0
  fi

  REASON=$(cat << 'EOF'
⚠️ BLOCKED: You MUST run /check-skills and /self-review before creating a PR.

STEP 1 (MANDATORY — do this NOW):
  Use the Skill tool with skill="check-skills"
  Review the output and address any skill update suggestions.

STEP 2 (MANDATORY):
  Use the Skill tool with skill="self-review"
  Fix what the review confirms. Put declined findings in the PR description.

STEP 3 (ONLY after completing Steps 1 and 2):
  Commit any changes Steps 1 and 2 made, so the PR includes them.
  Re-run your gh pr create command with '# pre-pr-checks-done' appended as a bash comment.
  Example: gh pr create --title "..." --body "..." # pre-pr-checks-done

⛔ DO NOT skip Step 1 or 2. DO NOT append '# pre-pr-checks-done' without completing both.
   Using the marker without running both checks is a violation of project rules.
   The old '# skip-skill-check' marker no longer bypasses this hook.
   If you already ran both checks in this conversation, you may proceed to Step 3.
EOF
)

  # Use hookSpecificOutput format for more reliable blocking
  jq -n --arg reason "$REASON" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
fi

# Default: allow command to proceed without modification
echo '{"continue": true}'
