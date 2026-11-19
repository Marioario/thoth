/**
 * Skill Auto-Activation Hook (UserPromptSubmit)
 *
 * Analyzes user prompts and suggests relevant skills using progressive disclosure.
 * Starts at domain level, drills down to subdomains and specific skills as needed.
 *
 * Also detects PR-related prompts and runs skill evolution analysis to suggest
 * skill updates before PR creation.
 *
 * Input (stdin): JSON with { prompt, session_id, ... }
 * Output (stdout): Formatted skill suggestions (becomes context for Claude)
 */
import { readFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { PROJECT_DIR, SKILL_RULES_PATH, hasSkillRules, useProjectFrom, } from './project.mjs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// ============================================================================
// Skill Rules Loading
// ============================================================================
function loadSkillRules() {
    try {
        const content = readFileSync(SKILL_RULES_PATH, 'utf-8');
        return JSON.parse(content);
    }
    catch (error) {
        console.error(`Failed to load skill rules: ${error}`);
        process.exit(0);
    }
}
// ============================================================================
// Matching Functions
// ============================================================================
function matchesKeywords(prompt, keywords) {
    const lowerPrompt = prompt.toLowerCase();
    return keywords.filter((kw) => lowerPrompt.includes(kw.toLowerCase()));
}
function matchesIntentPatterns(prompt, patterns) {
    return patterns.filter((pattern) => {
        try {
            const regex = new RegExp(pattern, 'i');
            return regex.test(prompt);
        }
        catch {
            return false;
        }
    });
}
function checkPromptTriggers(prompt, triggers) {
    if (!triggers)
        return [];
    const matched = [];
    if (triggers.keywords) {
        const keywordMatches = matchesKeywords(prompt, triggers.keywords);
        if (keywordMatches.length > 0) {
            // Check if any exclude keywords are present — if so, suppress all keyword matches
            const excluded = triggers.excludeKeywords && matchesKeywords(prompt, triggers.excludeKeywords).length > 0;
            if (!excluded) {
                matched.push(`keywords: ${keywordMatches.slice(0, 3).join(', ')}${keywordMatches.length > 3 ? '...' : ''}`);
            }
        }
    }
    if (triggers.intentPatterns) {
        const patternMatches = matchesIntentPatterns(prompt, triggers.intentPatterns);
        if (patternMatches.length > 0) {
            matched.push('intent pattern');
        }
    }
    return matched;
}
// ============================================================================
// Hierarchical Matching with Progressive Disclosure
// ============================================================================
function findMatches(prompt, rules) {
    const results = [];
    // Strategy: Check ALL levels independently, then deduplicate
    // This allows specific skills to match even if their parent domain doesn't
    // (e.g., "layout" matches studio subdomain even without "frontend" keyword)
    for (const [domainName, domain] of Object.entries(rules.domains)) {
        const domainMatches = checkPromptTriggers(prompt, domain.promptTriggers);
        let hasMoreSpecificMatch = false;
        // Check subdomains (regardless of domain match)
        if (domain.subdomains) {
            for (const [subdomainName, subdomain] of Object.entries(domain.subdomains)) {
                const subdomainMatches = checkPromptTriggers(prompt, subdomain.promptTriggers);
                let hasSkillMatch = false;
                // Check skills within subdomain (regardless of subdomain match)
                if (subdomain.skills) {
                    for (const [skillName, skill] of Object.entries(subdomain.skills)) {
                        const skillMatches = checkPromptTriggers(prompt, skill.promptTriggers);
                        if (skillMatches.length > 0) {
                            hasSkillMatch = true;
                            hasMoreSpecificMatch = true;
                            results.push({
                                level: 'skill',
                                name: skillName,
                                path: skill.path,
                                description: skill.description,
                                priority: skill.priority || rules.config.defaultPriority,
                                matchedBy: skillMatches,
                                parent: `${domainName}/${subdomainName}`,
                            });
                        }
                    }
                }
                // If subdomain matched but no specific skill, suggest subdomain
                if (subdomainMatches.length > 0 && !hasSkillMatch) {
                    hasMoreSpecificMatch = true;
                    results.push({
                        level: 'subdomain',
                        name: subdomainName,
                        path: subdomain.path,
                        description: subdomain.description,
                        priority: subdomain.priority || rules.config.defaultPriority,
                        matchedBy: subdomainMatches,
                        parent: domainName,
                    });
                }
            }
        }
        // Check direct skills under domain (regardless of domain match)
        if (domain.skills) {
            for (const [skillName, skill] of Object.entries(domain.skills)) {
                const skillMatches = checkPromptTriggers(prompt, skill.promptTriggers);
                if (skillMatches.length > 0) {
                    hasMoreSpecificMatch = true;
                    results.push({
                        level: 'skill',
                        name: skillName,
                        path: skill.path,
                        description: skill.description,
                        priority: skill.priority || rules.config.defaultPriority,
                        matchedBy: skillMatches,
                        parent: domainName,
                    });
                }
            }
        }
        // Only suggest domain if it matched AND nothing more specific matched
        if (domainMatches.length > 0 && !hasMoreSpecificMatch) {
            results.push({
                level: 'domain',
                name: domainName,
                path: domain.path,
                description: domain.description,
                priority: domain.priority || rules.config.defaultPriority,
                matchedBy: domainMatches,
            });
        }
    }
    return results;
}
// ============================================================================
// Output Formatting
// ============================================================================
const PRIORITY_ORDER = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
};
const PRIORITY_EMOJI = {
    critical: '\u26A0\uFE0F ',
    high: '\u{1F4DA}',
    medium: '\u{1F4A1}',
    low: '\u{1F4CC}',
};
const PRIORITY_LABEL = {
    critical: 'CRITICAL (Required)',
    high: 'RECOMMENDED',
    medium: 'SUGGESTED',
    low: 'OPTIONAL',
};
// ============================================================================
// PR Detection and Skill Evolution
// ============================================================================
const PR_PATTERNS = [
    /\b(create|make|open|submit)\s+(a\s+)?(pr|pull\s*request)\b/i,
    /\bpr\s+(for|with|to)\b/i,
    /\bpull\s*request\b/i,
    /\bgh\s+pr\s+create\b/i,
    /\bready\s+(for|to)\s+(pr|review|merge)\b/i,
    /\blet'?s\s+(pr|merge)\b/i,
];
function detectsPRIntent(prompt) {
    return PR_PATTERNS.some((pattern) => pattern.test(prompt));
}
const LOG_FILE = '/tmp/skill-hook.log';
function log(message) {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
}
function runSkillEvolution() {
    try {
        const script = join(__dirname, 'skill-evolution.mjs');
        const output = execFileSync(process.execPath, [script], {
            encoding: 'utf-8',
            cwd: PROJECT_DIR,
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 30000,
        });
        return output;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`skill-evolution error: ${message}`);
        return '';
    }
}
function formatOutput(matches) {
    if (matches.length === 0) {
        return '';
    }
    // Sort by priority then by specificity (skill > subdomain > domain)
    const levelOrder = { skill: 0, subdomain: 1, domain: 2 };
    matches.sort((a, b) => {
        const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        if (priorityDiff !== 0)
            return priorityDiff;
        return levelOrder[a.level] - levelOrder[b.level];
    });
    // Deduplicate - if we have a specific skill, don't also show its parent domain
    const seen = new Set();
    const deduped = matches.filter((m) => {
        const key = m.path;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
    // Group by priority
    const grouped = new Map();
    for (const match of deduped) {
        const priority = match.priority;
        if (!grouped.has(priority)) {
            grouped.set(priority, []);
        }
        grouped.get(priority).push(match);
    }
    const lines = [];
    lines.push('');
    lines.push('\u2501'.repeat(55));
    lines.push('\u{1F3AF} SKILL ACTIVATION - Progressive Disclosure');
    lines.push('\u2501'.repeat(55));
    lines.push('');
    for (const priority of ['critical', 'high', 'medium', 'low']) {
        const group = grouped.get(priority);
        if (!group || group.length === 0)
            continue;
        lines.push(`${PRIORITY_EMOJI[priority]} ${PRIORITY_LABEL[priority]}:`);
        lines.push('');
        for (const match of group) {
            const levelIndicator = match.level === 'skill' ? '\u{1F4C4}' : match.level === 'subdomain' ? '\u{1F4C1}' : '\u{1F4E6}';
            lines.push(`   ${levelIndicator} ${match.name}`);
            lines.push(`      ${match.description}`);
            lines.push(`      \u2192 Read: ${match.path}`);
            if (match.parent) {
                lines.push(`      \u2514 Part of: ${match.parent}`);
            }
            lines.push('');
        }
    }
    lines.push('\u2501'.repeat(55));
    lines.push('\u{1F449} Read the skill file(s) above BEFORE responding');
    lines.push('   Start with the most specific match (skill > subdomain > domain)');
    lines.push('\u2501'.repeat(55));
    lines.push('');
    return lines.join('\n');
}
// ============================================================================
// Main
// ============================================================================
async function main() {
    let inputData = '';
    for await (const chunk of process.stdin) {
        inputData += chunk;
    }
    let input;
    try {
        input = JSON.parse(inputData);
    }
    catch {
        process.exit(0);
    }
    const prompt = input.prompt || '';
    if (!prompt.trim()) {
        process.exit(0);
    }
    useProjectFrom(input.cwd);
    // Thoth is installed for every repository, but only repositories with a skill-rules.json have
    // skills to suggest. Stay silent everywhere else.
    if (!hasSkillRules()) {
        process.exit(0);
    }
    const outputs = [];
    // Check for PR intent and run skill evolution analysis
    if (detectsPRIntent(prompt)) {
        const evolutionOutput = runSkillEvolution();
        if (evolutionOutput) {
            outputs.push(evolutionOutput);
        }
    }
    // Run skill activation matching
    const rules = loadSkillRules();
    const matches = findMatches(prompt, rules);
    const skillOutput = formatOutput(matches);
    if (skillOutput) {
        outputs.push(skillOutput);
    }
    if (outputs.length > 0) {
        process.stdout.write(outputs.join('\n'));
    }
    process.exit(0);
}
main().catch(() => process.exit(0));
