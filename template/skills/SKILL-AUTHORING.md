# Skill Authoring Guide

How to create and maintain skills in this codebase.

## When to Create/Update Skills

Run `/check-skills` before every PR. It analyzes your changes and suggests:
- **UPDATE**: Add patterns to existing skill files
- **NEW**: Create new skill files for uncovered areas

## Skill Structure

Skills use progressive disclosure - start broad, get specific:

```
.claude/skills/
├── SKILL-AUTHORING.md       # This file
├── skill-rules.json         # Auto-activation triggers
│
├── domain-a/
│   ├── SKILL.md             # Domain overview
│   ├── specific-topic.md    # Specific skill
│   └── subdomain/
│       ├── SKILL.md         # Subdomain overview
│       └── topic.md         # Specific skill
│
└── domain-b/
    └── SKILL.md
```

## Creating a New Skill

### 1. Determine Placement

| Scope | Location | Example |
|-------|----------|---------|
| Whole domain | `domain/SKILL.md` | `backend/SKILL.md` |
| Subdomain | `domain/subdomain/SKILL.md` | `frontend/components/SKILL.md` |
| Specific topic | `domain/topic.md` | `backend/auth.md` |

### 2. Write the Skill File

Use this template:

```markdown
# [Topic] Skill

Brief one-line description.

## Overview
What this subsystem does and why it exists.

## Architecture
` ` `
path/to/files/
├── key-file.ts          # What it does
├── another-file.ts      # What it does
└── types.ts
` ` `

## Key Patterns

### Pattern Name
When to use this pattern and how.

` ` `typescript
// Code example
` ` `

## Key Files
- `path/to/important.ts` - Brief description
- `path/to/another.ts` - Brief description

## Common Tasks

### Task Name
Step-by-step instructions.

## Gotchas
- Known issues or non-obvious behaviors
```

### 3. Register in skill-rules.json

Add triggers so Claude auto-activates the skill:

```json
{
  "skills": {
    "your-skill": {
      "path": "domain/your-skill.md",
      "description": "Brief description",
      "promptTriggers": {
        "keywords": ["relevant", "terms"],
        "intentPatterns": ["create.*thing", "add.*feature"]
      },
      "fileTriggers": {
        "pathPatterns": ["**/relevant/**/*.ts"],
        "contentPatterns": ["specificFunction", "SpecificClass"]
      }
    }
  }
}
```

## Trigger Types

| Trigger | Purpose | Example |
|---------|---------|---------|
| `keywords` | Words in user prompt | `["layout", "canvas"]` |
| `intentPatterns` | Regex on user intent | `["create.*endpoint"]` |
| `pathPatterns` | Files being touched | `["**/routes/**"]` |
| `contentPatterns` | Code content | `["authenticateToken"]` |

## Evolution Patterns

In `skill-rules.json`, the `config.evolutionPatterns` array defines patterns that the evolution engine detects in your changes. Each pattern can optionally suggest a specific skill to update:

```json
{
  "config": {
    "evolutionPatterns": [
      {
        "name": "api-changes",
        "description": "Backend API changes",
        "test": "/(routes|controllers|services)/",
        "minFiles": 2,
        "suggestSkill": { "path": "backend/SKILL.md", "name": "backend", "domain": "backend" }
      }
    ]
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique pattern identifier |
| `description` | Yes | Human-readable description |
| `test` | Yes | Regex pattern to match file paths |
| `fileFilter` | No | `isNew`, `isModified`, or `any` (default) |
| `minFiles` | No | Minimum files to trigger (default: 1) |
| `suggestSkill` | No | Skill to suggest updating when pattern matches |

## Best Practices

1. **Be specific** - Document actual patterns, not generic advice
2. **Include code** - Real examples from the codebase
3. **Link to files** - Reference actual paths: `src/routes/auth.ts:45`
4. **Keep current** - Update when patterns change
5. **Progressive disclosure** - Domain SKILL.md links to specific skills

## Updating Existing Skills

When `/check-skills` suggests an update:

1. Read the suggested skill file
2. Add the new pattern/file reference
3. Ensure examples reflect current code
4. Update `skill-rules.json` if new triggers needed

## Verification

After creating/updating skills:

1. Run `/check-skills` again - should show no suggestions for your changes
2. Test activation: ask Claude about the topic, verify skill gets loaded
3. Review with team if introducing major new patterns
