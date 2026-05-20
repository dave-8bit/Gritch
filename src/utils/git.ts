import simpleGit from 'simple-git';

const git = simpleGit();

export async function getStagedDiff(): Promise<string> {
  const diff = await git.diff(['--cached']);
  if (!diff) {
    throw new Error('No staged changes found. Stage your changes with git add first.');
  }
  return diff;
}

export async function getCommitDiff(hash: string): Promise<string> {
  const diff = await git.show([hash]);
  if (!diff) {
    throw new Error('Commit not found.');
  }
  return diff;
}

export async function getCommitsBetween(from: string, to: string): Promise<string> {
  const log = await git.log({ from, to });

  if (!log?.all?.length) {
    throw new Error('No commits found between those references.');
  }

  const lines = log.all.map((c) => {
    // simple-git commit fields may not include `type`, so we derive it from the conventional commit prefix.
    const hash = c.hash;
    const message = c.message;

    const typeMatch = message.match(/^([a-z]+)(\([^)]+\))?:\s+/i);
    const type = typeMatch?.[1] ?? '';

    return `${type}: ${hash} — ${message}`.replace(/^\s*:\s*/, '');
  });

  return lines.join('\n');
}

export async function validateRepo(): Promise<void> {
  try {
    await git.status();
  } catch {
    throw new Error('Not a git repository. Please run gitwise inside a git project.');
  }
}

