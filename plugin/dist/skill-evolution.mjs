/**
 * Skill Evolution Hook
 *
 * Analyzes changes made during a session and suggests skill updates or new skills.
 * Creates a self-reinforcing feedback loop:
 *
 * 1. Skills guide development
 * 2. Development reveals gaps in skills
 * 3. This hook identifies those gaps
 * 4. User updates skills
 * 5. Better skills guide future development
 *
 * Usage:
 * - Runs when a prompt mentions opening a PR (via the skill activation hook)
 * - Runs via the /thoth:check-skills skill
 * - Can be run directly from a repository: node <plugin>/dist/skill-evolution.mjs
 */
import { existsSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { PROJECT_DIR, SKILLS_DIR, SKILL_RULES_PATH } from './project.mjs';
// ============================================================================
// Git Analysis (with CI/shallow clone support)
// ============================================================================
function parseNumstat(output) {
    return output
        .trim()
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
        const parts = line.split('\t');
        const [additions, deletions, path] = parts;
        return {
            path: path || '',
            additions: parseInt(additions) || 0,
            deletions: parseInt(deletions) || 0,
            isNew: deletions === '0' || parseInt(deletions) === 0,
        };
    })
        .filter((f) => f.path && !f.path.startsWith('.claude/')); // Exclude .claude changes from analysis
}
/**
 * Untracked files never appear in `git diff`, so an all-new branch would read as
 * empty. Enumerated separately rather than via `git add -N`, which would mutate
 * the user's index.
 */
function getUntrackedFiles(projectDir) {
    try {
        const output = execSync('git ls-files --others --exclude-standard', {
            encoding: 'utf-8',
            cwd: projectDir,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        return output
            .trim()
            .split('\n')
            .filter((p) => p.trim() && !p.startsWith('.claude/'))
            .map((p) => {
            let additions = 0;
            try {
                const full = join(projectDir, p);
                if (statSync(full).size <= 1_000_000) {
                    const text = readFileSync(full, 'utf-8');
                    // Count lines like git: a trailing newline doesn't start a new line.
                    additions = text.split('\n').length - (text === '' || text.endsWith('\n') ? 1 : 0);
                }
            }
            catch {
                // Unreadable: still worth reporting as a new file.
            }
            return { path: p, additions, deletions: 0, isNew: true };
        });
    }
    catch {
        return [];
    }
}
function getChangedFiles(baseBranch = 'main') {
    const projectDir = PROJECT_DIR;
    // Allow CI to override the target branch
    const target = process.env.GITHUB_BASE_REF || process.env.BASE_BRANCH || baseBranch;
    const run = (cmd) => {
        try {
            return execSync(cmd, { encoding: 'utf-8', cwd: projectDir, stdio: ['pipe', 'pipe', 'pipe'] });
        }
        catch {
            return null; // Command failed — usually an unresolvable ref.
        }
    };
    try {
        // A base-relative diff is authoritative: if the base ref resolves, its
        // answer stands even when empty (branch is level with its base). Only when
        // neither resolves — shallow CI clone, no remote — do we guess from HEAD.
        let output = null;
        for (const cmd of [
            `git diff --numstat origin/${target}...HEAD`,
            `git diff --numstat ${target}...HEAD`,
        ]) {
            output = run(cmd);
            if (output !== null)
                break;
        }
        if (output === null) {
            for (const cmd of [
                `git diff --numstat HEAD~1...HEAD`,
                `git show --numstat --format="" HEAD`,
            ]) {
                output = run(cmd);
                if (output?.trim())
                    break;
            }
        }
        // Decide on the raw diff, before parseNumstat drops `.claude/` paths: a
        // branch that only commits skill edits still has committed work.
        if (output?.trim())
            return { files: parseNumstat(output), source: 'committed' };
        // Nothing committed to analyze — fall back to the working tree so an
        // in-progress change doesn't report a clean bill of health.
        let working = [];
        try {
            const output = execSync('git diff --numstat HEAD', {
                encoding: 'utf-8',
                cwd: projectDir,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            working = parseNumstat(output);
        }
        catch {
            // No HEAD yet (fresh repo) — untracked files below still apply.
        }
        working = working.concat(getUntrackedFiles(projectDir));
        return working.length > 0
            ? { files: working, source: 'working-tree' }
            : { files: [], source: 'committed' };
    }
    catch {
        return { files: [], source: 'committed' };
    }
}
function getRecentCommitMessages(count = 10) {
    const projectDir = PROJECT_DIR;
    try {
        const output = execSync(`git log --oneline -${count}`, {
            encoding: 'utf-8',
            cwd: projectDir,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        return output.trim().split('\n').filter(Boolean);
    }
    catch {
        return [];
    }
}
function getCurrentBranch() {
    const projectDir = PROJECT_DIR;
    try {
        return execSync('git branch --show-current', {
            encoding: 'utf-8',
            cwd: projectDir,
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
    }
    catch {
        return 'unknown';
    }
}
function getModifiedSkillFiles(baseBranch = 'main', source = 'committed') {
    const projectDir = PROJECT_DIR;
    const target = process.env.GITHUB_BASE_REF || process.env.BASE_BRANCH || baseBranch;
    try {
        const commands = source === 'working-tree'
            ? [
                `git diff --name-only HEAD -- .claude/skills/`,
                `git ls-files --others --exclude-standard -- .claude/skills/`,
            ]
            : [
                `git diff --name-only origin/${target}...HEAD -- .claude/skills/`,
                `git diff --name-only ${target}...HEAD -- .claude/skills/`,
            ];
        // Working-tree mode unions modified and untracked skills. Committed mode
        // stops at the first base ref that resolves: a stale local base would
        // count upstream skill edits as changes made in this branch.
        const modified = new Set();
        for (const cmd of commands) {
            try {
                const output = execSync(cmd, {
                    encoding: 'utf-8',
                    cwd: projectDir,
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
                for (const p of output.trim().split('\n').filter(Boolean)) {
                    modified.add(p.replace(/^\.claude\/skills\//, ''));
                }
                if (source === 'committed')
                    break;
            }
            catch {
                continue;
            }
        }
        return modified;
    }
    catch {
        // ignore
    }
    return new Set();
}
/**
 * Parses a skill .md file and extracts file paths it references.
 * Looks for paths in backticks, "Key Files" list items, and code block comments.
 * Returns paths normalized to repo-relative form (no leading slash).
 */
function getSkillReferencedPaths(skillRelativePath) {
    const fullPath = join(SKILLS_DIR, skillRelativePath);
    const paths = new Set();
    try {
        const content = readFileSync(fullPath, 'utf-8');
        // Pattern 1: backtick-wrapped file paths like `/frontend/src/utils/elementId.ts`
        const backtickPaths = content.matchAll(/`\/?([a-zA-Z][\w.-]*(?:\/[\w.-]+)+\.\w+)`/g);
        for (const match of backtickPaths) {
            paths.add(match[1]);
        }
        // Pattern 2: "Key Files" list items: `- /path/to/file.ts - Description`
        const listPaths = content.matchAll(/^[ \t]*[-*]\s+\/?([a-zA-Z][\w.-]*(?:\/[\w.-]+)+\.\w+)/gm);
        for (const match of listPaths) {
            paths.add(match[1]);
        }
        // Pattern 3: code block comments: `// /path/to/file.ts` or `// path/to/file.ts`
        const commentPaths = content.matchAll(/\/\/\s+\/?([a-zA-Z][\w.-]*(?:\/[\w.-]+)+\.\w+)/g);
        for (const match of commentPaths) {
            paths.add(match[1]);
        }
    }
    catch {
        // Skill file doesn't exist or can't be read
    }
    return paths;
}
/**
 * True when this file's diff adds or removes a line matching the repository's
 * `publicApiPattern`, i.e. the change is visible to consumers and therefore
 * something the docs may need to describe.
 */
function diffTouchesPublicApi(diff, publicApi) {
    return diff
        .split('\n')
        .filter((l) => (l.startsWith('+') || l.startsWith('-')) && !l.startsWith('+++') && !l.startsWith('---'))
        .some((l) => publicApi.test(l.slice(1)));
}
function touchesPublicApi(filePath, baseBranch, source, publicApi) {
    const projectDir = PROJECT_DIR;
    const target = process.env.GITHUB_BASE_REF || process.env.BASE_BRANCH || baseBranch;
    const quoted = `'${filePath.replace(/'/g, `'\\''`)}'`;
    if (source === 'working-tree') {
        try {
            const output = execSync(`git diff -U0 HEAD -- ${quoted}`, {
                encoding: 'utf-8',
                cwd: projectDir,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            if (output.trim())
                return diffTouchesPublicApi(output, publicApi);
        }
        catch {
            // Fall through to the untracked-file check.
        }
        // Untracked: no diff to read, so judge the whole file.
        try {
            const content = readFileSync(join(projectDir, filePath), 'utf-8');
            return content.split('\n').some((l) => publicApi.test(l));
        }
        catch {
            return false;
        }
    }
    const commands = [
        `git diff -U0 origin/${target}...HEAD -- ${quoted}`,
        `git diff -U0 ${target}...HEAD -- ${quoted}`,
        `git diff -U0 HEAD~1...HEAD -- ${quoted}`,
        `git show -U0 --format="" HEAD -- ${quoted}`,
    ];
    for (const cmd of commands) {
        try {
            const output = execSync(cmd, {
                encoding: 'utf-8',
                cwd: projectDir,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            if (!output.trim())
                continue;
            return diffTouchesPublicApi(output, publicApi);
        }
        catch {
            continue;
        }
    }
    return false;
}
/**
 * Flags package Docs whose subject matter changed in this branch but which
 * weren't themselves updated. Consumer-facing docs (integration notes, event
 * API, telemetry) drift silently otherwise.
 */
function detectStaleDocs(files, rules, source) {
    if (!rules?.docs?.length)
        return [];
    const projectDir = PROJECT_DIR;
    const baseBranch = rules.config?.baseBranch || 'main';
    const changedPaths = new Set(files.map((f) => f.path));
    const publicApiCache = new Map();
    let publicApi = null;
    try {
        if (rules.config?.publicApiPattern)
            publicApi = new RegExp(rules.config.publicApiPattern);
    }
    catch {
        // Invalid regex in config: treat every change as relevant rather than none.
        console.error(`Ignoring invalid config.publicApiPattern: ${rules.config?.publicApiPattern}`);
    }
    const suggestions = [];
    for (const doc of rules.docs) {
        if (!Array.isArray(doc.watch)) {
            console.error(`Ignoring docs entry without a watch array: ${doc.path}`);
            continue;
        }
        // Git reports repo-relative paths; accept `./Docs/x.md` or `/Docs/x.md` in config.
        const docPath = doc.path.replace(/^(\.\/|\/)+/, '');
        // Doc already updated in this branch — nothing to nag about.
        if (changedPaths.has(docPath))
            continue;
        const triggeringFiles = files
            .filter((f) => f.path !== docPath)
            .filter((f) => doc.watch.some((p) => matchesGlobPattern(f.path, p)))
            .filter((f) => {
            if (doc.anyChange || !publicApi)
                return true;
            if (!publicApiCache.has(f.path)) {
                publicApiCache.set(f.path, touchesPublicApi(f.path, baseBranch, source, publicApi));
            }
            return publicApiCache.get(f.path);
        })
            .map((f) => f.path);
        if (triggeringFiles.length === 0)
            continue;
        suggestions.push({
            docPath: doc.path,
            package: doc.package,
            description: doc.description,
            exists: existsSync(join(projectDir, docPath)),
            triggeringFiles,
        });
    }
    return suggestions;
}
// ============================================================================
// Improved Glob Matching (with proper dot escaping)
// ============================================================================
function matchesGlobPattern(filePath, pattern) {
    try {
        const regexPattern = pattern
            .replace(/\./g, '\\.') // Escape dots FIRST (for files like schema.prisma)
            .replace(/\*\*/g, '###GLOB_DOUBLE###') // Placeholder to prevent conflict
            .replace(/\*/g, '[^/]*') // Single * matches within directory
            .replace(/###GLOB_DOUBLE###/g, '.*') // ** matches across directories
            .replace(/\//g, '\\/'); // Escape slashes
        return new RegExp(`^${regexPattern}$`).test(filePath);
    }
    catch {
        return false;
    }
}
// ============================================================================
// Pattern Detection (extensible via config)
// ============================================================================
function detectPatterns(files, globalPatterns, evolutionPatterns) {
    const patterns = [];
    // ── Built-in universal patterns (always active) ──────────────────────
    // 1. Significant Directory Changes (The "Big Feature" detector)
    const dirCounts = files.reduce((acc, file) => {
        const dir = dirname(file.path);
        if (!acc[dir])
            acc[dir] = { count: 0, additions: 0 };
        acc[dir].count++;
        acc[dir].additions += file.additions;
        return acc;
    }, {});
    Object.entries(dirCounts).forEach(([dir, stats]) => {
        if (stats.count >= 3 && stats.additions > 100) {
            patterns.push({
                pattern: 'significant-directory-change',
                files: files.filter((f) => dirname(f.path) === dir).map((f) => f.path),
                description: `High velocity change in ${dir}: ${stats.count} files, ${stats.additions} lines added`,
            });
        }
    });
    // 2. Significant new files (large new files that may introduce new patterns)
    const significantNewFiles = files.filter((f) => f.isNew && f.additions >= 50);
    if (significantNewFiles.length > 0) {
        patterns.push({
            pattern: 'significant-new-files',
            files: significantNewFiles.map((f) => f.path),
            description: `Significant new files (${significantNewFiles.length} files, 50+ lines each)`,
        });
    }
    // ── Config-driven evolution patterns ─────────────────────────────────
    if (evolutionPatterns && evolutionPatterns.length > 0) {
        for (const ep of evolutionPatterns) {
            try {
                const regex = new RegExp(ep.test);
                const matchingFiles = files.filter((f) => {
                    if (!regex.test(f.path))
                        return false;
                    if (ep.fileFilter === 'isNew')
                        return f.isNew;
                    if (ep.fileFilter === 'isModified')
                        return !f.isNew;
                    return true; // 'any' or unset
                });
                const minFiles = ep.minFiles ?? 1;
                if (matchingFiles.length >= minFiles) {
                    patterns.push({
                        pattern: ep.name,
                        files: matchingFiles.map((f) => f.path),
                        description: `${ep.description} (${matchingFiles.length} files)`,
                    });
                }
            }
            catch {
                // Invalid regex in config — skip this pattern
            }
        }
    }
    // ── Legacy global patterns (v2 compat) ──────────────────────────────
    if (globalPatterns) {
        for (const gp of globalPatterns) {
            const matchingFiles = files.filter((f) => {
                return gp.rules.some((rule) => {
                    const pathMatches = matchesGlobPattern(f.path, rule.path);
                    const typeMatches = !rule.type || rule.type === 'any' || (rule.type === 'new' && f.isNew) || (rule.type === 'modified' && !f.isNew);
                    return pathMatches && typeMatches;
                });
            });
            if (matchingFiles.length > 0) {
                patterns.push({
                    pattern: gp.name,
                    files: matchingFiles.map((f) => f.path),
                    description: `${gp.description} (${matchingFiles.length} files)`,
                });
            }
        }
    }
    return patterns;
}
// ============================================================================
// Skill Coverage Analysis
// ============================================================================
function loadSkillRules() {
    try {
        return JSON.parse(readFileSync(SKILL_RULES_PATH, 'utf-8'));
    }
    catch {
        return null;
    }
}
function findCoveringSkill(filePath, rules) {
    // Find the MOST SPECIFIC match by checking all levels
    let bestMatch = null;
    let bestSpecificity = 0; // Higher = more specific
    for (const [domainName, domain] of Object.entries(rules.domains)) {
        // Check domain file triggers
        const domainMatches = domain.fileTriggers?.pathPatterns?.some((p) => matchesGlobPattern(filePath, p)) ?? false;
        if (!domainMatches)
            continue;
        // Domain matched (specificity = 1)
        if (bestSpecificity < 1) {
            bestMatch = { domain: domainName, skillFilePath: domain.path, specificity: 1 };
            bestSpecificity = 1;
        }
        // Check subdomains (specificity = 2)
        if (domain.subdomains) {
            for (const [subName, subdomain] of Object.entries(domain.subdomains)) {
                const subMatches = subdomain.fileTriggers?.pathPatterns?.some((p) => matchesGlobPattern(filePath, p)) ?? false;
                if (subMatches && bestSpecificity < 2) {
                    bestMatch = { domain: domainName, subdomain: subName, skillFilePath: subdomain.path, specificity: 2 };
                    bestSpecificity = 2;
                }
                // Check skills within subdomain (specificity = 3)
                if (subdomain.skills) {
                    for (const [skillName, skill] of Object.entries(subdomain.skills)) {
                        const skillMatches = skill.fileTriggers?.pathPatterns?.some((p) => matchesGlobPattern(filePath, p)) ?? false;
                        if (skillMatches && bestSpecificity < 3) {
                            bestMatch = { domain: domainName, subdomain: subName, skill: skillName, skillFilePath: skill.path, specificity: 3 };
                            bestSpecificity = 3;
                        }
                    }
                }
            }
        }
        // Check direct skills under domain (specificity = 2.5)
        if (domain.skills) {
            for (const [skillName, skill] of Object.entries(domain.skills)) {
                const skillMatches = skill.fileTriggers?.pathPatterns?.some((p) => matchesGlobPattern(filePath, p)) ?? false;
                if (skillMatches && bestSpecificity < 2.5) {
                    bestMatch = { domain: domainName, skill: skillName, skillFilePath: skill.path, specificity: 2.5 };
                    bestSpecificity = 2.5;
                }
            }
        }
    }
    return bestMatch;
}
// ============================================================================
// Domain Inference (derived from skill-rules.json domains + pathPatterns)
// ============================================================================
/**
 * Infers which domain a file path belongs to by checking pathPatterns
 * from skill-rules.json domains. Falls back to the first path segment.
 */
function inferDomain(filePath, rules) {
    if (rules) {
        for (const [domainName, domain] of Object.entries(rules.domains)) {
            const matches = domain.fileTriggers?.pathPatterns?.some((p) => matchesGlobPattern(filePath, p)) ?? false;
            if (matches)
                return domainName;
        }
    }
    // Fallback: use first path segment (e.g., "frontend/src/..." → "frontend")
    return filePath.split('/')[0] || 'other';
}
function newSkillPath(domain, skillName) {
    return existsSync(join(SKILLS_DIR, domain, 'SKILL.md')) ? `${domain}/${skillName}` : skillName;
}
// ============================================================================
// Suggestion Generation
// ============================================================================
function generateSuggestions(files, patterns, rules, source) {
    const suggestions = [];
    const skillsDir = SKILLS_DIR;
    // Find uncovered files
    const uncoveredFiles = [];
    const coveredAreas = new Map();
    const coverageBySkillPath = new Map();
    if (rules) {
        for (const file of files) {
            const coverage = findCoveringSkill(file.path, rules);
            if (!coverage) {
                uncoveredFiles.push(file);
            }
            else {
                const key = coverage.skill || coverage.subdomain || coverage.domain;
                if (!coveredAreas.has(key)) {
                    coveredAreas.set(key, []);
                }
                coveredAreas.get(key).push(file);
                // Track by skill file path for staleness detection
                const skillPath = coverage.skillFilePath;
                if (!coverageBySkillPath.has(skillPath)) {
                    coverageBySkillPath.set(skillPath, { result: coverage, files: [] });
                }
                coverageBySkillPath.get(skillPath).files.push(file);
            }
        }
    }
    // Staleness detection: flag skills that explicitly reference files that were
    // modified in this branch, but whose skill .md was not itself updated.
    // This is content-aware — we parse the skill file for referenced paths rather
    // than using a blunt line-count threshold.
    if (rules) {
        const baseBranch = rules.config?.baseBranch || 'main';
        const modifiedSkillFiles = getModifiedSkillFiles(baseBranch, source);
        const changedPaths = new Set(files.map((f) => f.path));
        for (const [skillPath, { result }] of coverageBySkillPath) {
            // Only flag specific skills (specificity >= 2.5) to avoid false positives
            if (result.specificity < 2.5)
                continue;
            // If the skill file was already modified in this branch, no staleness
            if (modifiedSkillFiles.has(skillPath))
                continue;
            // Parse the skill .md for file paths it documents
            const referencedPaths = getSkillReferencedPaths(skillPath);
            if (referencedPaths.size === 0)
                continue;
            // Find which referenced files were actually modified
            const staleRefs = [...referencedPaths].filter((p) => changedPaths.has(p));
            if (staleRefs.length === 0)
                continue;
            const skillName = result.skill || result.subdomain || result.domain;
            suggestions.push({
                type: 'update',
                skillPath,
                skillName,
                domain: result.domain,
                reason: `${staleRefs.length} file(s) documented in this skill were modified`,
                suggestedContent: staleRefs.slice(0, 5),
            });
        }
    }
    // Suggest new skills for uncovered areas
    if (uncoveredFiles.length >= 3) {
        const byDir = new Map();
        for (const file of uncoveredFiles) {
            const dir = dirname(file.path);
            if (dir === '.')
                continue;
            const relevantDir = dir.split('/').slice(0, 3).join('/');
            if (!byDir.has(relevantDir)) {
                byDir.set(relevantDir, []);
            }
            byDir.get(relevantDir).push(file);
        }
        for (const [dir, dirFiles] of byDir) {
            if (dirFiles.length >= 2) {
                // Name from the whole path: `apps/web/src` and `packages/ui/src` must
                // not both become `src` and overwrite each other.
                const skillName = dir.replace(/\//g, '-');
                const domain = inferDomain(dir, rules);
                const skillPath = newSkillPath(domain, skillName);
                // Never suggest a scaffold that would overwrite an existing skill.
                if (existsSync(join(skillsDir, skillPath, 'SKILL.md')))
                    continue;
                suggestions.push({
                    type: 'new',
                    skillName,
                    domain,
                    reason: `${dirFiles.length} files changed in ${dir} with no skill coverage`,
                    suggestedContent: dirFiles.slice(0, 5).map((f) => f.path),
                    scaffoldCommand: `mkdir -p "${skillsDir}/${skillPath}" && cat > "${skillsDir}/${skillPath}/SKILL.md" << 'EOF'
---
name: ${skillName}
description: "[What this covers]. Use when [tasks that should load it]."
---

# ${skillName.charAt(0).toUpperCase() + skillName.slice(1)} Skill

## Overview
[Description of this subsystem]

## Architecture
\`\`\`
${dir}/
├── [key files]
\`\`\`

## Key Patterns
[Document patterns here]

## Key Files
${dirFiles.slice(0, 5).map((f) => `- \`${f.path}\``).join('\n')}
EOF`,
                });
            }
        }
    }
    // Suggest updates based on detected patterns — config-driven via suggestSkill
    const evolutionPatterns = rules?.config?.evolutionPatterns || [];
    const evolutionPatternMap = new Map(evolutionPatterns.map((ep) => [ep.name, ep]));
    for (const pattern of patterns) {
        const ep = evolutionPatternMap.get(pattern.pattern);
        // Config-driven suggestion via suggestSkill
        if (ep?.suggestSkill) {
            suggestions.push({
                type: 'update',
                skillPath: ep.suggestSkill.path,
                skillName: ep.suggestSkill.name,
                domain: ep.suggestSkill.domain,
                reason: `${ep.description} - verify patterns are documented`,
                suggestedContent: pattern.files.slice(0, 5),
            });
            continue;
        }
        // Built-in: significant-directory-change → suggest new skill
        if (pattern.pattern === 'significant-directory-change') {
            const dir = pattern.files[0]?.split('/').slice(0, 3).join('/');
            if (dir && !suggestions.some((s) => s.skillName === dir.split('/').pop())) {
                suggestions.push({
                    type: 'new',
                    skillName: dir.split('/').pop() || 'new-feature',
                    domain: inferDomain(dir, rules),
                    reason: pattern.description,
                    suggestedContent: [`Major development in ${dir} - consider creating a dedicated skill`],
                });
            }
        }
        // Built-in: significant-new-files → flag uncovered files
        if (pattern.pattern === 'significant-new-files') {
            const uncoveredNewFiles = pattern.files.filter((filePath) => {
                if (!rules)
                    return true;
                return !findCoveringSkill(filePath, rules);
            });
            if (uncoveredNewFiles.length > 0) {
                const domain = inferDomain(uncoveredNewFiles[0], rules);
                suggestions.push({
                    type: 'new',
                    skillName: 'new-subsystem',
                    domain,
                    reason: `${uncoveredNewFiles.length} significant new file(s) not covered by any skill: ${uncoveredNewFiles.join(', ')}`,
                    suggestedContent: ['Consider creating a skill if these files introduce a new pattern or subsystem'],
                });
            }
        }
    }
    // Deduplicate
    const seen = new Set();
    return suggestions.filter((s) => {
        const key = `${s.type}-${s.skillName}-${s.domain}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
// ============================================================================
// Output Formatting
// ============================================================================
function formatOutput(files, patterns, suggestions, docSuggestions, commitMessages, branch, rules, source) {
    const lines = [];
    lines.push('');
    lines.push('\u2501'.repeat(65));
    lines.push('\u{1F9EC} SKILL EVOLUTION ANALYSIS');
    lines.push('\u2501'.repeat(65));
    lines.push('');
    // Branch context
    lines.push(`\u{1F33F} Branch: ${branch}`);
    if (source === 'working-tree') {
        lines.push('   Source: UNCOMMITTED working tree (nothing committed to compare against the base)');
    }
    lines.push('');
    // Summary
    lines.push('\u{1F4CA} CHANGE SUMMARY');
    lines.push(`   Files changed: ${files.length}`);
    lines.push(`   Additions: +${files.reduce((s, f) => s + f.additions, 0)} lines`);
    lines.push(`   Deletions: -${files.reduce((s, f) => s + f.deletions, 0)} lines`);
    // Domain breakdown — derived dynamically from skill-rules.json domains
    const domainNames = rules ? Object.keys(rules.domains) : [];
    const domainCounts = new Map();
    let otherCount = 0;
    for (const file of files) {
        const domain = inferDomain(file.path, rules);
        if (domainNames.includes(domain)) {
            domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
        }
        else {
            otherCount++;
        }
    }
    lines.push('');
    for (const [domain, count] of domainCounts) {
        if (count > 0)
            lines.push(`   \u{1F4E6} ${domain}: ${count} files`);
    }
    if (otherCount > 0)
        lines.push(`   \u{1F4C1} Other: ${otherCount} files`);
    lines.push('');
    // Patterns detected
    if (patterns.length > 0) {
        lines.push('\u{1F50D} PATTERNS DETECTED');
        for (const pattern of patterns) {
            lines.push(`   \u2022 ${pattern.description}`);
        }
        lines.push('');
    }
    // Skill suggestions
    if (suggestions.length > 0) {
        lines.push('\u{1F4A1} SKILL EVOLUTION SUGGESTIONS');
        lines.push('');
        const updates = suggestions.filter((s) => s.type === 'update');
        const newSkills = suggestions.filter((s) => s.type === 'new');
        if (updates.length > 0) {
            lines.push('   \u{1F4DD} UPDATE EXISTING SKILLS:');
            for (const s of updates) {
                lines.push(`      \u2192 ${s.skillPath}`);
                lines.push(`         Reason: ${s.reason}`);
                if (s.suggestedContent && s.suggestedContent.length > 0) {
                    const fileList = s.suggestedContent.slice(0, 3).join(', ');
                    lines.push(`         Files: ${fileList}${s.suggestedContent.length > 3 ? '...' : ''}`);
                }
                lines.push('');
            }
        }
        if (newSkills.length > 0) {
            lines.push('   \u{2728} CONSIDER NEW SKILLS:');
            for (const s of newSkills) {
                const skillPath = newSkillPath(s.domain, s.skillName);
                lines.push(`      \u2192 ${skillPath}/SKILL.md`);
                lines.push(`         Reason: ${s.reason}`);
                if (s.scaffoldCommand) {
                    lines.push('');
                    lines.push('         \u{1F6E0}\uFE0F  Scaffold command:');
                    lines.push('````bash');
                    lines.push(s.scaffoldCommand);
                    lines.push('````');
                    lines.push('         Fill in the description.');
                }
                if (skillPath.includes('/')) {
                    lines.push(`         Link it from .claude/skills/${s.domain}/SKILL.md: nested skills aren't discovered on their own`);
                }
                lines.push('');
            }
        }
    }
    else {
        lines.push('\u2705 No skill updates suggested - current coverage looks good!');
        lines.push('');
    }
    // Package docs
    if (docSuggestions.length > 0) {
        lines.push('\u{1F4DA} DOCS TO UPDATE');
        lines.push('');
        const byPackage = new Map();
        for (const d of docSuggestions) {
            if (!byPackage.has(d.package))
                byPackage.set(d.package, []);
            byPackage.get(d.package).push(d);
        }
        for (const [pkg, docs] of byPackage) {
            lines.push(`   \u{1F4E6} ${pkg}`);
            for (const d of docs) {
                lines.push(`      → ${d.docPath}${d.exists ? '' : '  (MISSING — create it)'}`);
                lines.push(`         Covers: ${d.description}`);
                const fileList = d.triggeringFiles.slice(0, 3).join(', ');
                lines.push(`         Changed: ${fileList}${d.triggeringFiles.length > 3 ? ` (+${d.triggeringFiles.length - 3} more)` : ''}`);
                lines.push('');
            }
        }
        lines.push("   Describe what changed for the doc's readers, not how the code moved around.");
        lines.push('');
    }
    else if (rules?.docs?.length) {
        lines.push('✅ Docs look current for these changes.');
        lines.push('');
    }
    // Recent commits for context
    if (commitMessages.length > 0) {
        lines.push('\u{1F4DD} RECENT COMMITS');
        for (const msg of commitMessages.slice(0, 5)) {
            lines.push(`   ${msg}`);
        }
        lines.push('');
    }
    lines.push('\u2501'.repeat(65));
    lines.push('\u{1F449} Review suggestions above');
    lines.push(rules?.docs?.length
        ? '   Skills and docs should evolve with your codebase - update them in this PR!'
        : '   Skills should evolve with your codebase - update them in this PR!');
    lines.push('   Run /thoth:check-skills anytime to re-analyze');
    lines.push('\u2501'.repeat(65));
    lines.push('');
    return lines.join('\n');
}
// ============================================================================
// Main
// ============================================================================
async function main() {
    const rules = loadSkillRules();
    const baseBranch = rules?.config?.baseBranch || 'main';
    const { files, source } = getChangedFiles(baseBranch);
    const commitMessages = getRecentCommitMessages();
    const branch = getCurrentBranch();
    const patterns = detectPatterns(files, rules?.globalPatterns, rules?.config?.evolutionPatterns);
    const suggestions = generateSuggestions(files, patterns, rules, source);
    const docSuggestions = detectStaleDocs(files, rules, source);
    const output = formatOutput(files, patterns, suggestions, docSuggestions, commitMessages, branch, rules, source);
    process.stdout.write(output);
    process.exit(0);
}
main().catch((err) => {
    console.error('Skill evolution analysis failed:', err);
    process.exit(0);
});
