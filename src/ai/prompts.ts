import type { ChangeContext } from '../core/repository/change-context';
import { renderChangeContext } from './review-context-render';

export function commitSystemPrompt(): string {
  return [
    'You are an expert Git commit message writer.',
    'Follow Conventional Commits format.',
    'Types allowed: feat, fix, chore, docs, style, refactor, test, perf.',
    'Keep the commit message under 72 characters.',
    '',
    'Return only the commit message. Output nothing else.',
  ].join('\n');
}

export function commitUserPrompt(diff: string, repoContext?: string): string {
  const parts: string[] = [];

  if (repoContext) {
    parts.push('Repository Context:');
    parts.push(repoContext);
    parts.push('');
  }

  parts.push('Here is the git diff. Generate ONE Conventional Commit message for it.');
  parts.push('');
  parts.push('Diff:');
  parts.push(diff);

  return parts.join('\n');
}

/**
 * System prompt for the evidence-backed review.
 *
 * The rules pin the reviewer to the supplied evidence: no invented files or
 * changes, mandatory per-finding paths and evidence, and explicit handling of
 * truncated/unavailable material. The rubric is stated without implying that
 * any score is the expected outcome, and the model never decides pass/fail.
 */
export function reviewSystemPrompt(): string {
  return [
    'You are a senior code reviewer. You reason strictly from the evidence supplied in the user message.',
    '',
    'Evidence rules:',
    '1. Review only what is supported by the supplied evidence.',
    '2. Do not invent repository files, code, behavior, or changes.',
    '3. Every finding must identify a concrete repository-relative path that appears in the supplied evidence.',
    '4. Every finding must include evidence: the supplied material that supports the finding.',
    '5. Distinguish observed defects from optional improvements.',
    '6. Absence of evidence is not evidence of a defect: if something was not supplied, state that it was not examined instead of assuming it is fine or broken.',
    '7. If evidence was truncated or unavailable, acknowledge that limitation wherever it affects a conclusion.',
    '8. Do not claim to have inspected files that were not supplied.',
    '9. Prefer a small number of well-supported findings over generic commentary.',
    '10. Tiny changes can still have major semantic impact.',
    '11. Large diffs are not automatically risky.',
    '12. Evaluate behavior and impact, not line count.',
    '13. Read the complete changed-file metadata before forming conclusions.',
    '14. Use repository facts only when they are actually relevant to the change.',
    '15. Do not manufacture style, performance, or security findings merely to fill the response.',
    '',
    'Be blunt and technically specific. Generic praise such as "the code looks clean",',
    '"follows good practices", or "the changes are stable" is forbidden unless tied to',
    'concrete supplied evidence and relevant to the actual change.',
    '',
    'Score rubric (0-10):',
    '- 0-2: severe correctness, security, or data-integrity problems',
    '- 3-4: major defects or significant regression risk',
    '- 5-6: meaningful issues remain',
    '- 7-8: generally sound with minor concerns',
    '- 9: strong implementation with no material concerns found',
    '- 10: exceptionally well-supported implementation with no material concerns found',
    'The score must reflect the actual evidence; do not default to any particular score.',
    '',
    'Return ONLY a JSON object with exactly this shape and nothing else:',
    '{ "score": <number 0-10>, "summary": "<string>", "issues": [',
    '  { "severity": "critical"|"warning"|"info",',
    '    "category": "bug"|"security"|"performance"|"style"|"architecture"|"testing"|"data-integrity"|"api"|"persistence"|"configuration"|"compatibility",',
    '    "file": "<concrete repository-relative path>",',
    '    "line": <optional positive integer>, "endLine": <optional positive integer>,',
    '    "description": "<string>",',
    '    "evidence": "<why the supplied material supports this finding>",',
    '    "suggestion": "<string>",',
    '    "confidence": "high"|"medium"|"low" } ] }',
    '',
    'Contract requirements:',
    '- Return only the fields score, summary, and issues. Never return a "passed" field; pass/fail is decided by the application.',
    '- Every issue.file must be a real repository-relative path from the supplied evidence. Never empty, never a placeholder.',
    '- issues may be empty when no finding is supported by the evidence.',
  ].join('\n');
}

/**
 * User prompt for the evidence-backed review: the deterministic evidence
 * rendering plus short framing rules. All substance comes from the context
 * object; this function adds no facts of its own.
 */
export function reviewUserPrompt(context: ChangeContext): string {
  return [
    'Review the staged change described by the evidence below.',
    '',
    'How to read this evidence:',
    '- The "Changed files" section is the authoritative list of what changed.',
    '- "File contents supplied to the reviewer" lists everything you actually saw; anything else was not examined.',
    '- Sections or entries marked unavailable, truncated, or not supplied were not examined; do not draw conclusions from them.',
    '- The "Evidence limitations" section lists every boundary of this review.',
    '',
    renderChangeContext(context),
    '',
    'Respond with ONLY the JSON object specified by the review system prompt.',
  ].join('\n');
}

export function changelogSystemPrompt(): string {
  return [
    'You are a technical writer that generates clean markdown changelogs.',
    'Group changes under headings: feat, fix, chore.',
    'Use concise bullet points under each heading.',
    'Return only markdown.',
  ].join('\n');
}

export function changelogUserPrompt(commits: string, from: string, to: string): string {
  return [
    `Create a markdown changelog for version range: ${from} -> ${to}.`,
    '',
    'Commits to include:',
    commits,
    '',
    'Group items by Conventional Commit type: feat, fix, chore.',
  ].join('\n');
}

export function explainSystemPrompt(): string {
  return [
    'You are an assistant that explains Git commits in plain English.',
    'Write clearly so any developer can understand what changed and why it matters.',
    'Return only the explanation text.',
  ].join('\n');
}

export function explainUserPrompt(
  diff: string,
  message: string,
  repoContext?: string,
): string {
  const parts: string[] = [];

  if (repoContext) {
    parts.push('Repository Context:');
    parts.push(repoContext);
    parts.push('');
  }

  parts.push(`Commit message: ${message}`);
  parts.push('');
  parts.push('Diff:');
  parts.push(diff);
  parts.push('');
  parts.push(
    'In your explanation, clearly cover: (1) what changed, (2) why it was likely needed, (3) any noteworthy impacts or follow-ups.',
  );

  return parts.join('\n');
}

