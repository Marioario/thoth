---
description: Suggest skill and doc updates for this branch's changes. Run before opening a PR.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/skill-evolution.mjs")
---

# Skill Evolution Analysis

Analyze the current branch's changes and suggest updates to the repository's skills and docs.

## 1. Check that this repository uses Thoth

If `.claude/skills/skill-rules.json` doesn't exist in the repository root, Thoth isn't set up
here. Say so, mention `/thoth:setup`, and stop. There is nothing to check.

## 2. Run the analysis

Run it from the repository root:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/skill-evolution.mjs"
```

It reports:
1. What files have changed in this branch
2. What patterns were detected (new components, API changes, etc.)
3. Which skills cover these changes
4. What skill updates or new skills are recommended
5. Which docs describe code that changed but weren't updated, if the repository configures
   `docs` in `skill-rules.json`

## 3. Act on the output

- **UPDATE suggestions**: add the new patterns and documentation to the existing skill files.
- **NEW skill suggestions**: create skill files for uncovered areas. Use the scaffold command it
  prints, and see `.claude/skills/SKILL-AUTHORING.md` for the format.
- **DOCS TO UPDATE**: for each listed doc:
  1. Read the doc first. Match its structure and voice instead of appending a changelog note.
  2. Describe what changed for the doc's readers, not how the code moved around.
  3. Update every place the change surfaces: walkthroughs, reference tables, troubleshooting.
  4. `(MISSING — create it)` means there's no doc at that path yet. Create it only if the change
     warrants one; otherwise say so.
  5. If a listed doc genuinely needs no change, say why instead of editing it.
- **No suggestions**: current coverage is adequate.

Skill paths in the output are relative to `.claude/skills/`. When it suggests updating
`backend/database.md`, the file is `.claude/skills/backend/database.md`.

## 4. Follow this repository's extra steps

If `.claude/skills/check-skills.local.md` exists, read it and follow its instructions as part
of this check. Repositories use it for steps that apply only to them.

Skills should evolve with the codebase. If this change introduces new patterns or subsystems,
document them so future work benefits.
