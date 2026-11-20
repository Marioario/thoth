# Thoth

Living knowledge for your codebase. A [Claude Code](https://claude.com/claude-code) plugin that
gives Claude institutional memory about each repository (architecture decisions, code patterns,
gotchas), keeps that knowledge in sync as the code evolves, and reviews every PR before it opens.

## What It Does

**Skill Activation**: when you prompt Claude, Thoth matches the prompt against the repository's
skill rules (keywords, intent patterns, file paths) and points Claude at the right skill files.

**Skill Evolution**: `/thoth:check-skills` analyzes the branch's changes and suggests skill
updates, new skills, and doc updates, so documentation keeps up with the code.

**Pre-PR Gate**: blocks `gh pr create` until Claude has run `/thoth:self-review`, and
`/thoth:check-skills` too in repositories that have skill rules. See
[Self-review before PRs](#self-review-before-prs).

Thoth is one plugin for every repository. The engine lives in the plugin; each repository keeps
only its own `.claude/skills/` folder.

## Install

**For an organization** (recommended): an Owner adds this under claude.ai → Organization
settings → Claude Code → Managed settings. Everyone signed in to the organization gets Thoth at
their next session start and can't turn it off.

```json
{
  "extraKnownMarketplaces": {
    "thoth": {
      "source": { "source": "github", "repo": "Marioario/thoth" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": { "thoth@thoth": true }
}
```

**For yourself**:

```bash
claude plugin marketplace add Marioario/thoth
claude plugin install thoth@thoth
```

Or inside Claude Code: `/plugin install thoth --marketplace Marioario/thoth` (Claude Code
2.1.275 or later).

## Set Up a Repository

The review gate works everywhere with no setup. Skill activation and `/thoth:check-skills` need
a `.claude/skills/skill-rules.json`; without one, Thoth stays silent in that repository.

Run `/thoth:setup` in the repository. It creates a starter `skill-rules.json` and
`SKILL-AUTHORING.md` under `.claude/skills/` and proposes a first set of domains. Then write the
skill files and commit `.claude/skills/`.

### skill-rules.json

```json
{
  "version": "3.0",
  "config": {
    "baseBranch": "main",
    "evolutionPatterns": [
      {
        "name": "api-changes",
        "description": "Backend API changes",
        "test": "/(routes|controllers)/",
        "minFiles": 2,
        "suggestSkill": { "path": "backend/SKILL.md", "name": "backend", "domain": "backend" }
      }
    ]
  },
  "domains": {
    "backend": {
      "path": "backend/SKILL.md",
      "description": "Backend API patterns",
      "promptTriggers": {
        "keywords": ["backend", "API", "endpoint"],
        "intentPatterns": ["(create|add).*endpoint"]
      },
      "fileTriggers": {
        "pathPatterns": ["backend/src/**/*.ts"]
      },
      "skills": {
        "auth": {
          "path": "backend/auth.md",
          "description": "Authentication patterns",
          "promptTriggers": { "keywords": ["auth", "login"] },
          "fileTriggers": { "pathPatterns": ["backend/src/auth/**"] }
        }
      }
    }
  }
}
```

**Domains** are top-level groupings (e.g. `backend`, `frontend`, `infrastructure`). Each has:
- `path`: the skill file to load, relative to `.claude/skills/`
- `promptTriggers.keywords`: words that activate it
- `promptTriggers.intentPatterns`: regex patterns for intent matching
- `fileTriggers.pathPatterns`: glob patterns for file-based matching
- `skills`: specific skills within the domain
- `subdomains`: nested domains (e.g. `frontend/studio`)

**Evolution patterns** in `config.evolutionPatterns` flag kinds of change worth a skill update:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier |
| `description` | Yes | What this pattern means |
| `test` | Yes | Regex to match file paths |
| `fileFilter` | No | `isNew`, `isModified`, or `any` |
| `minFiles` | No | Minimum files to trigger (default: 1) |
| `suggestSkill` | No | Skill to suggest updating |

Two patterns are always active: **significant-directory-change** (3+ files and 100+ lines in one
directory) and **significant-new-files** (new files with 50+ lines).

### Optional: keep docs in step with code

List docs under `docs` and `/thoth:check-skills` flags each one when the code it describes
changed in the branch but the doc didn't:

```json
{
  "config": { "publicApiPattern": "\\b(public|open)\\s|@_spi" },
  "docs": [
    {
      "path": "packages/widgets/docs/USAGE.md",
      "package": "widgets",
      "description": "How apps embed and configure widgets",
      "watch": ["packages/widgets/src/**"]
    }
  ]
}
```

- `watch`: glob patterns for the code the doc describes.
- `config.publicApiPattern`: optional regex for a changed line that alters a public API. When
  set, a doc is flagged only for such changes. The example matches Swift's `public`, `open` and
  `@_spi`. When unset, any change to a watched file counts.
- `anyChange: true` on an entry flags it on any change, even with `publicApiPattern` set.

### Optional: repository-specific check steps

Put extra instructions for `/thoth:check-skills` in `.claude/skills/check-skills.local.md`. The
skill reads and follows that file in this repository only.

## Self-review before PRs

Review work runs on each developer's own Claude account rather than on a paid review bot.

Before opening a PR, the gate makes Claude run `/thoth:self-review`. It reviews the branch's
diff in a subagent, which doesn't see the author's reasoning, so the read isn't anchored on it.
Claude fixes what it confirms, asks whether to run another round after any fixes, and puts
declined findings in the PR description.

The subagent is a `code-reviewer` agent if one is available, otherwise a general-purpose agent
running Claude Code's built-in `/code-review`. To use your own reviewer, put an agent named
`code-reviewer` in `~/.claude/agents/` (just for you) or `.claude/agents/` (for the repository).

When the gate blocks `gh pr create`, Claude runs the checks, commits any fixes, and retries the
command with `# pre-pr-checks-done` appended as a bash comment. The gate only starts for `gh pr`
commands, and if it fails, the command is blocked rather than let through.

## Migrating from the copied install

Earlier versions copied Thoth into each repository with `init.sh`. Once the plugin is enabled,
remove the copy so its hooks don't run twice:

1. Delete the files `init.sh` copied into `.claude/hooks/`: `skill-activation.ts`,
   `skill-activation.sh`, `skill-evolution.ts`, `skill-evolution.sh`, `pre-pr-check.sh`,
   `package.json`, `package-lock.json`, `.thoth-version` and `node_modules/`. Keep any hooks of
   your own.
2. Remove Thoth's `UserPromptSubmit` and `PreToolUse` entries from `.claude/settings.json`.
3. Delete `.claude/commands/check-skills.md` and `.claude/commands/self-review.md`.
4. Keep `.claude/skills/`. If the copy had local engine changes, check they're covered by the
   plugin or by the optional settings above.
5. Update docs that mention `/check-skills` or `/self-review` to `/thoth:check-skills` and
   `/thoth:self-review`.

## Development

```bash
npm install
npm run build      # compiles src/*.mts to plugin/dist/; commit the output
npm run validate   # claude plugin validate for the marketplace and the plugin
claude --plugin-dir ./plugin   # try the working copy in a session
```

The engine is TypeScript in `src/`, compiled to plain JavaScript in `plugin/dist/` so the plugin
needs no install step. CI fails if `plugin/dist/` doesn't match `src/`.

`plugin.json` has no `version`, so each commit to `main` that changes `plugin/` is a release:
installs with auto-update pick it up at their next check.

## Requirements

- Claude Code 2.1.295 or later (the gate uses `onFailure: "block"`)
- Node.js 18 or later on the `PATH`
- Git, and `gh` (GitHub CLI) for `/thoth:self-review`
