---
description: Set up Thoth in this repository with a starter skill-rules.json and authoring guide.
disable-model-invocation: true
---

# Set up Thoth in this repository

Thoth's review gate already works in every repository. This adds the parts that are per
repository: the skill rules that decide which skills to suggest, and the authoring guide.

1. Work from the repository root. Create `.claude/skills/` if it doesn't exist.
2. If `.claude/skills/skill-rules.json` already exists, leave it alone and say so. Otherwise copy
   `${CLAUDE_PLUGIN_ROOT}/templates/skill-rules.starter.json` to
   `.claude/skills/skill-rules.json`.
3. Copy `${CLAUDE_PLUGIN_ROOT}/templates/SKILL-AUTHORING.md` to
   `.claude/skills/SKILL-AUTHORING.md`, unless the repository already has one.
4. Set `config.baseBranch` in `skill-rules.json` to the repository's default branch
   (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`).
5. Look at the repository's top-level structure and propose a first set of domains for
   `skill-rules.json`: each with a skill path, keywords, and file path patterns. Show the
   proposal and ask before replacing the starter example.
6. Tell the developer what's next:
   - Write the first skill files under `.claude/skills/<domain>/SKILL.md`.
   - Commit `.claude/skills/`.
   - Run `/thoth:check-skills` to see coverage for the current branch.

Optional settings in `skill-rules.json`, mention them if they fit the repository:

- **`docs`**: a list of docs to keep in step with the code. Each entry has a `path`, a `package`
  name, a `description`, and `watch` glob patterns; `/thoth:check-skills` flags the doc when
  watched files change and the doc doesn't. Set `config.publicApiPattern` to a regex to flag only
  changes to public API lines, or `anyChange: true` on an entry to flag any change.
- **`.claude/skills/check-skills.local.md`**: extra instructions `/thoth:check-skills` follows
  in this repository only.
