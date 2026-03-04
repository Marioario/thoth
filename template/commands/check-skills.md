# Skill Evolution Analysis

Analyze the current branch's changes and suggest skill updates or new skills.

## Instructions

Run the skill evolution analysis to understand:
1. What files have changed in this branch
2. What patterns were detected (new components, API changes, etc.)
3. Which skills cover these changes
4. What skill updates or new skills are recommended

Execute the analysis by navigating to the hooks directory and running the script:

```bash
cd .claude/hooks && ./skill-evolution.sh
```

**NOTE**: Use relative path `.claude/hooks` (from project root) - don't use `$CLAUDE_PROJECT_DIR` literally in the command.

After reviewing the output:
- **UPDATE suggestions**: Consider adding new patterns/documentation to existing skill files
- **NEW skill suggestions**: Consider creating new skill files for uncovered areas
- **No suggestions**: Current skill coverage is adequate

**IMPORTANT**: Skills are located in `.claude/skills/` directory. When the analysis suggests updating a skill like `backend/database.md`, the full path is `.claude/skills/backend/database.md`.

Remember: Skills should evolve WITH your codebase. If you're introducing new patterns or subsystems, document them in skills so future work benefits from this context.

## When to Run

- Before creating a PR (to ensure skills are updated)
- After completing a significant feature
- When you notice Claude isn't following expected patterns
- Periodically to audit skill coverage
