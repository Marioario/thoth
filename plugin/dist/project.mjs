/**
 * Locates the repository Thoth is working in.
 *
 * Thoth runs from the plugin's install folder, not from inside the repository, so every path to
 * the repository's own files goes through these bindings. They're live ESM bindings: importers
 * read the current values after a hook calls `useProjectFrom()`.
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
function gitRoot(dir) {
    try {
        return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
    }
    catch {
        return null;
    }
}
/**
 * The repository root for a working directory: its git root, so paths from `git diff` and
 * `git ls-files` line up and a session in a subdirectory still finds `.claude/skills/`. Outside
 * git, fall back to `CLAUDE_PROJECT_DIR`, then the directory itself.
 */
function resolveRoot(dir) {
    return gitRoot(dir) ?? process.env.CLAUDE_PROJECT_DIR ?? dir;
}
export let PROJECT_DIR = resolveRoot(process.cwd());
export let SKILLS_DIR = join(PROJECT_DIR, '.claude', 'skills');
export let SKILL_RULES_PATH = join(SKILLS_DIR, 'skill-rules.json');
/**
 * Point Thoth at the directory Claude is working in. Hooks pass the payload's `cwd`, which
 * follows Claude into worktrees; `CLAUDE_PROJECT_DIR` stays at the directory the session started
 * in, so it would analyze the wrong checkout.
 */
export function useProjectFrom(dir) {
    if (!dir)
        return;
    // No CLAUDE_PROJECT_DIR fallback here: it's exactly the stale directory this overrides.
    PROJECT_DIR = gitRoot(dir) ?? dir;
    SKILLS_DIR = join(PROJECT_DIR, '.claude', 'skills');
    SKILL_RULES_PATH = join(SKILLS_DIR, 'skill-rules.json');
}
/** True when this repository has set Thoth up. Without it, Thoth's skill features stay silent. */
export function hasSkillRules() {
    return existsSync(SKILL_RULES_PATH);
}
