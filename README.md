# Thoth

Living knowledge for your codebase. A skill activation and evolution system for [Claude Code](https://claude.com/claude-code).

Thoth gives Claude institutional memory about your codebase — architecture decisions, code patterns, and gotchas — and keeps that knowledge in sync as the code evolves.

## What It Does

**Skill Activation** — When you prompt Claude, Thoth detects relevant skills based on keywords, intent patterns, and file paths, then loads the right context before responding.

**Skill Evolution** — Before PRs, Thoth analyzes your branch's changes and suggests skill updates or new skills to keep documentation in sync with code.

**Pre-PR Gate** — Blocks `gh pr create` until you've run `/check-skills` and `/self-review`, so
skills stay current and every PR is reviewed on the author's own Claude account before anyone
else reads it. See [Self-review before PRs](#self-review-before-prs).

## Quick Start

```bash
# Clone Thoth
git clone https://github.com/marioario/thoth.git /tmp/thoth

# From your repo root:
cd /path/to/your-repo
bash /tmp/thoth/init.sh
```

This will:
1. Create `.claude/hooks/`, `.claude/skills/`, `.claude/commands/`
2. Install the hook scripts and TypeScript engine
3. Install the commands
4. Create a starter `skill-rules.json` (or skip if one exists)
5. Configure hooks in `.claude/settings.json`
6. Run `npm install` for hook dependencies

## Configuration

### skill-rules.json

The central config file at `.claude/skills/skill-rules.json` controls everything:

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

### Domains

Top-level groupings (e.g., `backend`, `frontend`, `infrastructure`). Each domain has:
- `path` — Skill file to load (relative to `.claude/skills/`)
- `promptTriggers.keywords` — Words that activate this skill
- `promptTriggers.intentPatterns` — Regex patterns for intent matching
- `fileTriggers.pathPatterns` — Glob patterns for file-based activation
- `skills` — Specific skills within this domain
- `subdomains` — Nested domains (e.g., `frontend/studio`)

### Evolution Patterns

In `config.evolutionPatterns`, define patterns that the evolution engine detects:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier |
| `description` | Yes | What this pattern means |
| `test` | Yes | Regex to match file paths |
| `fileFilter` | No | `isNew`, `isModified`, or `any` |
| `minFiles` | No | Minimum files to trigger (default: 1) |
| `suggestSkill` | No | Skill to suggest updating |

Two universal patterns are always active:
- **significant-directory-change** — 3+ files and 100+ lines in same directory
- **significant-new-files** — New files with 50+ lines

## Writing Skills

See `.claude/skills/SKILL-AUTHORING.md` after installation for the full guide. In short:

1. Create a `.md` file in `.claude/skills/your-domain/`
2. Document architecture, patterns, key files, and gotchas
3. Register it in `skill-rules.json` with appropriate triggers
4. Run `/check-skills` to verify coverage

## Commands

- `/check-skills` — Run skill evolution analysis on current branch
- `/self-review [base-branch]` — Review the branch in a subagent and fix what it confirms

## Self-review before PRs

Review work runs on each developer's own Claude account rather than on a paid review bot.

Before opening a PR, the pre-PR gate makes Claude run `/self-review`. It reviews the branch's
diff in a subagent, which doesn't see the author's reasoning, so the read isn't anchored on it.
Claude fixes what it confirms, and declined findings go in the PR description.

The subagent is a `code-reviewer` agent if one is available, otherwise a general-purpose agent
running Claude Code's built-in `/code-review`. To use your own reviewer, put an agent named
`code-reviewer` in `~/.claude/agents/` (just for you) or `.claude/agents/` (for the whole repo).
Thoth doesn't install one, so `--update` never touches it.

When the gate blocks `gh pr create`, Claude runs both checks and retries the command with
`# pre-pr-checks-done` appended as a bash comment. The `# skip-skill-check` marker from earlier
versions no longer passes the gate.

## What Gets Installed

```
.claude/
├── hooks/
│   ├── skill-activation.ts    # Prompt → skill matching engine
│   ├── skill-activation.sh    # Shell wrapper
│   ├── skill-evolution.ts     # Change → suggestion engine
│   ├── skill-evolution.sh     # Shell wrapper
│   ├── pre-pr-check.sh        # PR gate hook
│   └── package.json           # Hook dependencies
├── skills/
│   ├── skill-rules.json       # Central config
│   ├── SKILL-AUTHORING.md     # Authoring guide
│   └── your-domain/           # Your skill files
│       └── SKILL.md
├── commands/
│   ├── check-skills.md        # /check-skills command
│   └── self-review.md         # /self-review command
└── settings.json              # Hook configuration
```

## Updating

To update Thoth's engine and commands (without touching your config):

```bash
bash /path/to/thoth/init.sh --update
```

This overwrites the TypeScript engine, shell wrappers, and Thoth's commands, but preserves your
`skill-rules.json`, skill files, and `settings.json`. A command file that differs from Thoth's
(including your own file with the same name) is replaced, and the old one is saved next to it as
`.bak`.

## Requirements

- Node.js 18+
- Git repository
- Claude Code CLI
- `jq` (without it the pre-PR gate can't read commands and lets everything through)
- `gh` (GitHub CLI), used by `/self-review` to find the default branch
