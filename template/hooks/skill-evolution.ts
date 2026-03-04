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
 * - Runs automatically on PR creation (via PreToolUse hook on `gh pr create`)
 * - Runs via /check-skills command
 * - Can be run directly: npx tsx skill-evolution.ts
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Types
// ============================================================================

interface SkillNode {
  path: string;
  description: string;
  promptTriggers?: {
    keywords?: string[];
    excludeKeywords?: string[];
    intentPatterns?: string[];
  };
  fileTriggers?: {
    pathPatterns?: string[];
    contentPatterns?: string[];
  };
  skills?: Record<string, SkillNode>;
  subdomains?: Record<string, SkillNode>;
}

interface EvolutionPattern {
  name: string;
  description: string;
  test: string; // regex pattern to match file paths
  fileFilter?: 'isNew' | 'isModified' | 'any';
  minFiles?: number;
  suggestSkill?: {
    path: string;
    name: string;
    domain: string;
  };
}

interface SkillRulesConfig {
  baseBranch?: string;
  progressiveDisclosure?: boolean | { enabled: boolean; startWith: string; drillDownOn: string[] };
  defaultPriority?: string;
  maxSuggestionsPerLevel?: number;
  evolutionPatterns?: EvolutionPattern[];
  [key: string]: unknown;
}

interface SkillRules {
  version: string;
  domains: Record<string, SkillNode>;
  config?: SkillRulesConfig;
  globalPatterns?: GlobalPattern[];
}

interface GlobalPattern {
  name: string;
  description: string;
  rules: Array<{
    path: string;
    type?: 'new' | 'modified' | 'any';
  }>;
}

interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  isNew: boolean;
}

interface PatternDetection {
  pattern: string;
  files: string[];
  description: string;
}

interface CoverageResult {
  domain: string;
  skill?: string;
  subdomain?: string;
  skillFilePath: string;
  specificity: number; // 1=domain, 2=subdomain, 2.5=domain-skill, 3=subdomain-skill
}

interface SkillSuggestion {
  type: 'update' | 'new';
  skillPath?: string;
  skillName: string;
  domain: string;
  reason: string;
  suggestedContent?: string[];
  scaffoldCommand?: string;
}

// ============================================================================
// Git Analysis (with CI/shallow clone support)
// ============================================================================

function getChangedFiles(baseBranch = 'main'): FileChange[] {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  // Allow CI to override the target branch
  const target = process.env.GITHUB_BASE_REF || process.env.BASE_BRANCH || baseBranch;

  try {
    // Try multiple strategies for different git contexts
    const commands = [
      `git diff --numstat origin/${target}...HEAD`,
      `git diff --numstat ${target}...HEAD`,
      `git diff --numstat HEAD~1...HEAD`,
      `git show --numstat --format="" HEAD`, // Fallback for single-commit scenarios
    ];

    let output = '';
    for (const cmd of commands) {
      try {
        output = execSync(cmd, {
          encoding: 'utf-8',
          cwd: projectDir,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (output.trim()) break;
      } catch {
        continue;
      }
    }

    if (!output.trim()) return [];

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
  } catch {
    return [];
  }
}

function getRecentCommitMessages(count = 10): string[] {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  try {
    const output = execSync(`git log --oneline -${count}`, {
      encoding: 'utf-8',
      cwd: projectDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function getCurrentBranch(): string {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  try {
    return execSync('git branch --show-current', {
      encoding: 'utf-8',
      cwd: projectDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

function getModifiedSkillFiles(baseBranch = 'main'): Set<string> {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const target = process.env.GITHUB_BASE_REF || process.env.BASE_BRANCH || baseBranch;

  try {
    const commands = [
      `git diff --name-only origin/${target}...HEAD -- .claude/skills/`,
      `git diff --name-only ${target}...HEAD -- .claude/skills/`,
    ];

    for (const cmd of commands) {
      try {
        const output = execSync(cmd, {
          encoding: 'utf-8',
          cwd: projectDir,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (output.trim()) {
          return new Set(
            output
              .trim()
              .split('\n')
              .filter(Boolean)
              .map((p) => p.replace(/^\.claude\/skills\//, ''))
          );
        }
      } catch {
        continue;
      }
    }
  } catch {
    // ignore
  }
  return new Set();
}

/**
 * Parses a skill .md file and extracts file paths it references.
 * Looks for paths in backticks, "Key Files" list items, and code block comments.
 * Returns paths normalized to repo-relative form (no leading slash).
 */
function getSkillReferencedPaths(skillRelativePath: string): Set<string> {
  const skillsDir = join(__dirname, '..', 'skills');
  const fullPath = join(skillsDir, skillRelativePath);
  const paths = new Set<string>();

  try {
    const content = readFileSync(fullPath, 'utf-8');

    // Pattern 1: backtick-wrapped file paths like `/frontend/src/utils/elementId.ts`
    const backtickPaths = content.matchAll(/`\/?([a-zA-Z][\w.-]*(?:\/[\w.-]+)+\.\w+)`/g);
    for (const match of backtickPaths) {
      paths.add(match[1]);
    }

    // Pattern 2: "Key Files" list items: `- /path/to/file.ts - Description`
    const listPaths = content.matchAll(/^[-*]\s+\/?([a-zA-Z][\w.-]*(?:\/[\w.-]+)+\.\w+)/gm);
    for (const match of listPaths) {
      paths.add(match[1]);
    }

    // Pattern 3: code block comments: `// /path/to/file.ts` or `// path/to/file.ts`
    const commentPaths = content.matchAll(/\/\/\s+\/?([a-zA-Z][\w.-]*(?:\/[\w.-]+)+\.\w+)/g);
    for (const match of commentPaths) {
      paths.add(match[1]);
    }
  } catch {
    // Skill file doesn't exist or can't be read
  }

  return paths;
}

// ============================================================================
// Improved Glob Matching (with proper dot escaping)
// ============================================================================

function matchesGlobPattern(filePath: string, pattern: string): boolean {
  try {
    const regexPattern = pattern
      .replace(/\./g, '\\.') // Escape dots FIRST (for files like schema.prisma)
      .replace(/\*\*/g, '###GLOB_DOUBLE###') // Placeholder to prevent conflict
      .replace(/\*/g, '[^/]*') // Single * matches within directory
      .replace(/###GLOB_DOUBLE###/g, '.*') // ** matches across directories
      .replace(/\//g, '\\/'); // Escape slashes

    return new RegExp(`^${regexPattern}$`).test(filePath);
  } catch {
    return false;
  }
}

// ============================================================================
// Pattern Detection (extensible via config)
// ============================================================================

function detectPatterns(
  files: FileChange[],
  globalPatterns?: GlobalPattern[],
  evolutionPatterns?: EvolutionPattern[]
): PatternDetection[] {
  const patterns: PatternDetection[] = [];

  // ── Built-in universal patterns (always active) ──────────────────────

  // 1. Significant Directory Changes (The "Big Feature" detector)
  const dirCounts = files.reduce(
    (acc, file) => {
      const dir = dirname(file.path);
      if (!acc[dir]) acc[dir] = { count: 0, additions: 0 };
      acc[dir].count++;
      acc[dir].additions += file.additions;
      return acc;
    },
    {} as Record<string, { count: number; additions: number }>
  );

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
          if (!regex.test(f.path)) return false;
          if (ep.fileFilter === 'isNew') return f.isNew;
          if (ep.fileFilter === 'isModified') return !f.isNew;
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
      } catch {
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

function loadSkillRules(): SkillRules | null {
  const rulesPath = join(__dirname, '..', 'skills', 'skill-rules.json');
  try {
    return JSON.parse(readFileSync(rulesPath, 'utf-8'));
  } catch {
    return null;
  }
}

function findCoveringSkill(
  filePath: string,
  rules: SkillRules
): CoverageResult | null {
  // Find the MOST SPECIFIC match by checking all levels
  let bestMatch: CoverageResult | null = null;
  let bestSpecificity = 0; // Higher = more specific

  for (const [domainName, domain] of Object.entries(rules.domains)) {
    // Check domain file triggers
    const domainMatches =
      domain.fileTriggers?.pathPatterns?.some((p) => matchesGlobPattern(filePath, p)) ?? false;

    if (!domainMatches) continue;

    // Domain matched (specificity = 1)
    if (bestSpecificity < 1) {
      bestMatch = { domain: domainName, skillFilePath: domain.path, specificity: 1 };
      bestSpecificity = 1;
    }

    // Check subdomains (specificity = 2)
    if (domain.subdomains) {
      for (const [subName, subdomain] of Object.entries(domain.subdomains)) {
        const subMatches =
          subdomain.fileTriggers?.pathPatterns?.some((p) => matchesGlobPattern(filePath, p)) ?? false;

        if (subMatches && bestSpecificity < 2) {
          bestMatch = { domain: domainName, subdomain: subName, skillFilePath: subdomain.path, specificity: 2 };
          bestSpecificity = 2;
        }

        // Check skills within subdomain (specificity = 3)
        if (subdomain.skills) {
          for (const [skillName, skill] of Object.entries(subdomain.skills)) {
            const skillMatches =
              skill.fileTriggers?.pathPatterns?.some((p) => matchesGlobPattern(filePath, p)) ?? false;

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
        const skillMatches =
          skill.fileTriggers?.pathPatterns?.some((p) => matchesGlobPattern(filePath, p)) ?? false;

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
function inferDomain(filePath: string, rules: SkillRules | null): string {
  if (rules) {
    for (const [domainName, domain] of Object.entries(rules.domains)) {
      const matches = domain.fileTriggers?.pathPatterns?.some((p) => matchesGlobPattern(filePath, p)) ?? false;
      if (matches) return domainName;
    }
  }
  // Fallback: use first path segment (e.g., "frontend/src/..." → "frontend")
  return filePath.split('/')[0] || 'other';
}

// ============================================================================
// Suggestion Generation
// ============================================================================

function generateSuggestions(
  files: FileChange[],
  patterns: PatternDetection[],
  rules: SkillRules | null
): SkillSuggestion[] {
  const suggestions: SkillSuggestion[] = [];
  const skillsDir = join(__dirname, '..', 'skills');

  // Find uncovered files
  const uncoveredFiles: FileChange[] = [];
  const coveredAreas = new Map<string, FileChange[]>();
  const coverageBySkillPath = new Map<string, { result: CoverageResult; files: FileChange[] }>();

  if (rules) {
    for (const file of files) {
      const coverage = findCoveringSkill(file.path, rules);
      if (!coverage) {
        uncoveredFiles.push(file);
      } else {
        const key = coverage.skill || coverage.subdomain || coverage.domain;
        if (!coveredAreas.has(key)) {
          coveredAreas.set(key, []);
        }
        coveredAreas.get(key)!.push(file);

        // Track by skill file path for staleness detection
        const skillPath = coverage.skillFilePath;
        if (!coverageBySkillPath.has(skillPath)) {
          coverageBySkillPath.set(skillPath, { result: coverage, files: [] });
        }
        coverageBySkillPath.get(skillPath)!.files.push(file);
      }
    }
  }

  // Staleness detection: flag skills that explicitly reference files that were
  // modified in this branch, but whose skill .md was not itself updated.
  // This is content-aware — we parse the skill file for referenced paths rather
  // than using a blunt line-count threshold.
  if (rules) {
    const baseBranch = rules.config?.baseBranch || 'main';
    const modifiedSkillFiles = getModifiedSkillFiles(baseBranch);
    const changedPaths = new Set(files.map((f) => f.path));

    for (const [skillPath, { result }] of coverageBySkillPath) {
      // Only flag specific skills (specificity >= 2.5) to avoid false positives
      if (result.specificity < 2.5) continue;

      // If the skill file was already modified in this branch, no staleness
      if (modifiedSkillFiles.has(skillPath)) continue;

      // Parse the skill .md for file paths it documents
      const referencedPaths = getSkillReferencedPaths(skillPath);
      if (referencedPaths.size === 0) continue;

      // Find which referenced files were actually modified
      const staleRefs = [...referencedPaths].filter((p) => changedPaths.has(p));
      if (staleRefs.length === 0) continue;

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
    const byDir = new Map<string, FileChange[]>();
    for (const file of uncoveredFiles) {
      const parts = file.path.split('/');
      const relevantDir = parts.slice(0, 3).join('/');
      if (!byDir.has(relevantDir)) {
        byDir.set(relevantDir, []);
      }
      byDir.get(relevantDir)!.push(file);
    }

    for (const [dir, dirFiles] of byDir) {
      if (dirFiles.length >= 2) {
        const skillName = dir.split('/').pop() || 'unknown';
        const domain = inferDomain(dir, rules);
        const skillPath = `${domain}/${skillName}`;

        suggestions.push({
          type: 'new',
          skillName,
          domain,
          reason: `${dirFiles.length} files changed in ${dir} with no skill coverage`,
          suggestedContent: dirFiles.slice(0, 5).map((f) => f.path),
          scaffoldCommand: `mkdir -p ${skillsDir}/${skillPath} && cat > ${skillsDir}/${skillPath}/SKILL.md << 'EOF'
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
        if (!rules) return true;
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
  const seen = new Set<string>();
  return suggestions.filter((s) => {
    const key = `${s.type}-${s.skillName}-${s.domain}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================================
// Output Formatting
// ============================================================================

function formatOutput(
  files: FileChange[],
  patterns: PatternDetection[],
  suggestions: SkillSuggestion[],
  commitMessages: string[],
  branch: string,
  rules: SkillRules | null
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('\u2501'.repeat(65));
  lines.push('\u{1F9EC} SKILL EVOLUTION ANALYSIS');
  lines.push('\u2501'.repeat(65));
  lines.push('');

  // Branch context
  lines.push(`\u{1F33F} Branch: ${branch}`);
  lines.push('');

  // Summary
  lines.push('\u{1F4CA} CHANGE SUMMARY');
  lines.push(`   Files changed: ${files.length}`);
  lines.push(`   Additions: +${files.reduce((s, f) => s + f.additions, 0)} lines`);
  lines.push(`   Deletions: -${files.reduce((s, f) => s + f.deletions, 0)} lines`);

  // Domain breakdown — derived dynamically from skill-rules.json domains
  const domainNames = rules ? Object.keys(rules.domains) : [];
  const domainCounts = new Map<string, number>();
  let otherCount = 0;

  for (const file of files) {
    const domain = inferDomain(file.path, rules);
    if (domainNames.includes(domain)) {
      domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
    } else {
      otherCount++;
    }
  }

  lines.push('');
  for (const [domain, count] of domainCounts) {
    if (count > 0) lines.push(`   \u{1F4E6} ${domain}: ${count} files`);
  }
  if (otherCount > 0) lines.push(`   \u{1F4C1} Other: ${otherCount} files`);
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
        lines.push(`      \u2192 ${s.domain}/${s.skillName}/SKILL.md`);
        lines.push(`         Reason: ${s.reason}`);
        if (s.scaffoldCommand) {
          lines.push('');
          lines.push('         \u{1F6E0}\uFE0F  Scaffold command:');
          lines.push('         ```bash');
          // Show abbreviated command
          lines.push(`         mkdir -p .claude/skills/${s.domain}/${s.skillName}`);
          lines.push(`         # Then create SKILL.md with overview, architecture, patterns`);
          lines.push('         ```');
        }
        lines.push('');
      }
    }
  } else {
    lines.push('\u2705 No skill updates suggested - current coverage looks good!');
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
  lines.push('   Skills should evolve with your codebase - update them in this PR!');
  lines.push('   Run /check-skills anytime to re-analyze');
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
  const files = getChangedFiles(baseBranch);
  const commitMessages = getRecentCommitMessages();
  const branch = getCurrentBranch();

  const patterns = detectPatterns(files, rules?.globalPatterns, rules?.config?.evolutionPatterns);
  const suggestions = generateSuggestions(files, patterns, rules);

  const output = formatOutput(files, patterns, suggestions, commitMessages, branch, rules);
  process.stdout.write(output);

  process.exit(0);
}

main().catch((err) => {
  console.error('Skill evolution analysis failed:', err);
  process.exit(0);
});
