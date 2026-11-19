/**
 * Pre-PR gate (PreToolUse hook, Bash matcher)
 *
 * Blocks Claude from opening a pull request until it has reviewed the change. Every repository
 * needs /thoth:self-review; repositories with a skill-rules.json also need /thoth:check-skills.
 *
 * Input (stdin): the PreToolUse hook payload, with the Bash command in `tool_input.command`.
 * Output (stdout): a deny decision when the command opens a PR without the completion marker;
 * nothing otherwise, which lets the command run.
 *
 * The hook is registered with `onFailure: "block"`, so if this script crashes the command is
 * blocked rather than let through.
 */
import { hasSkillRules, useProjectFrom } from './project.mjs';
const PR_CREATE = /\bgh\s+pr\s+(create|new)\b/;
const MARKER = 'pre-pr-checks-done';
function denyReason(checkSkills) {
    const steps = [];
    if (checkSkills) {
        steps.push('Use the Skill tool with skill="thoth:check-skills"\n' +
            '  Review the output and address any skill update suggestions.');
    }
    steps.push('Use the Skill tool with skill="thoth:self-review"\n' +
        '  Fix what the review confirms. Put declined findings in the PR description.');
    const checks = checkSkills ? '/thoth:check-skills and /thoth:self-review' : '/thoth:self-review';
    const both = checkSkills ? 'both checks' : 'the review';
    const lines = [`⚠️ BLOCKED: You MUST run ${checks} before creating a PR.`, ''];
    steps.forEach((step, i) => {
        lines.push(`STEP ${i + 1} (MANDATORY):`, `  ${step}`, '');
    });
    const done = steps.length + 1;
    lines.push(`STEP ${done} (ONLY after completing the steps above):`, '  Commit any changes those steps made, so the PR includes them.', `  Re-run your gh pr create command with '# ${MARKER}' appended as a bash comment.`, `  Example: gh pr create --title "..." --body "..." # ${MARKER}`, '', `⛔ DO NOT append '# ${MARKER}' without running ${both} first.`, `   Using the marker without running ${both} is a violation of project rules.`, `   If you already ran ${both} in this conversation, you may proceed to the last step.`);
    return lines.join('\n');
}
async function main() {
    let raw = '';
    for await (const chunk of process.stdin)
        raw += chunk;
    let command = '';
    let cwd;
    try {
        const payload = JSON.parse(raw);
        command = payload?.tool_input?.command ?? '';
        cwd = payload?.cwd;
    }
    catch {
        return; // Not a payload we understand: leave the command alone.
    }
    if (!PR_CREATE.test(command) || command.includes(MARKER))
        return;
    useProjectFrom(cwd);
    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: denyReason(hasSkillRules()),
        },
    }));
}
await main();
