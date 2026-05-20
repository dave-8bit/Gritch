export function commitSystemPrompt(): string {
  return [
    'You are an expert Git commit message writer.',
    'Follow Conventional Commits format.',
    'Types allowed: feat, fix, chore, docs, style, refactor, test, perf.',
    '',
    'Return only the commit message. Output nothing else.',
  ].join('\n');
}

export function commitUserPrompt(diff: string): string {
  return [
    'Here is the git diff. Generate ONE Conventional Commit message for it.',
    '',
    'Diff:',
    diff,
  ].join('\n');
}

export function reviewSystemPrompt(): string {
  return [
    'You are a senior code reviewer.',
    'Return a JSON object ONLY with this exact shape:',
    '{ score: number, summary: string, issues: Array<{ severity: "critical"|"warning"|"info", category: "bug"|"security"|"performance"|"style", description: string, suggestion: string }>, passed: boolean }',
    '',
    'passed must be true if score is 7 or above; otherwise false.',
    'Do not include any other text.',
  ].join('\n');
}

export function reviewUserPrompt(diff: string, language: string): string {
  return [
    `Review the following code diff. Language: ${language}.`,
    '',
    'Diff:',
    diff,
    '',
    'Respond with ONLY the exact JSON shape specified by the review system prompt.',
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

export function explainUserPrompt(diff: string, message: string): string {
  return [
    'Explain the following commit.',
    '',
    `Commit message: ${message}`,
    '',
    'Diff:',
    diff,
    '',
    'In your explanation, clearly cover: (1) what changed, (2) why it was likely needed, (3) any noteworthy impacts or follow-ups.',
  ].join('\n');
}

