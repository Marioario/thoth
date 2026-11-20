---
description: Review this branch in a subagent and fix what it confirms, before opening a PR
argument-hint: [base-branch]
---

Review this branch's changes before anyone else does, and fix what the review confirms. The goal
is that human reviewers and review bots find nothing a careful read would have caught, and that
this work runs on your own Claude account instead of a paid review bot.

## 1. Scope the change

- Base branch: `$ARGUMENTS` if given; otherwise `config.baseBranch` in
  `.claude/skills/skill-rules.json` (the base `/thoth:check-skills` uses); otherwise the repo's
  default branch (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`).
- Run `git fetch origin <base>`, then `git diff origin/<base>...HEAD --stat` and `git status`.
  Uncommitted changes are part of the review; say if there are any.
- If there is nothing to review, say so and stop.

## 2. Get an independent review

Run the review in a subagent, so it reads the code fresh instead of through this conversation.
Pick the agent:

- **A `code-reviewer` agent, if one is available** (the developer's own in `~/.claude/agents/`, or
  the repo's in `.claude/agents/`): launch it with `subagent_type: "code-reviewer"`. This is how a
  developer swaps in their own reviewer without changing the repo.
- **Otherwise, a general-purpose subagent** that runs Claude Code's built-in `code-review` skill
  (Skill tool, `skill: "code-review"`, args: `medium`). If that skill isn't available, it reviews
  the diff itself.

Give the subagent the base branch, how to see the change (`git diff origin/<base>...HEAD`, plus
`git diff HEAD` for uncommitted work), and what the change is for, in a sentence or two. Ask for
verified findings ranked by severity, each with `file:line`, the problem, and a concrete failure
scenario. Do not give it your own assessment of the code; the point is a read that isn't anchored
on yours.

## 3. Act on the findings

Check each finding against the code before acting on it. Reviewers are sometimes wrong.

- Bugs and security problems: fix them. If you are certain one is wrong, say why in the report.
- Other real problems: fix them, unless out of scope for this change; then list them as follow-ups.
- Style and nits: apply only if trivial and clearly better.

Keep fixes minimal and in the style of the surrounding code. Then rerun the tests and linter for
the files you touched.

If you changed any code, summarize what changed in a line or two, then ask the developer
(AskUserQuestion) whether to run another review on the updated diff. Recommend yes if you fixed
bugs or made non-trivial changes. If they say yes, go back to step 2 with a fresh subagent;
otherwise continue. Ask again after each round that changes code. If nothing changed, don't ask.

Commit the fixes, and push if the branch is already on the remote, before the PR is created.
`gh pr create` only sees pushed commits.

## 4. Report

- A one-line verdict.
- Each finding, and whether it was fixed, declined (with the reason) or deferred.
- Anything a human reviewer should look at closely.
- A short draft for the PR description: what the change does and why, and what each group of
  changes is for. Reviewers read the big picture first; give it to them.

Carry declined and deferred findings into the PR description, so reviewers can see what was
considered and left out on purpose.
