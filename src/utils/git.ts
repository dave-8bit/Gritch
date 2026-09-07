import simpleGit from 'simple-git';

import { resolveRepoRoot } from '../inspect/root';

const git = simpleGit();

export interface RepositoryCommit {
  hash: string;
  author: string;
  date: string;
  subject: string;
}

export async function getStagedDiff(): Promise<string> {
  const diff = await git.diff(['--cached']);
  if (!diff) {
    throw new Error('No staged changes found. Stage your changes with git add first.');
  }
  return diff;
}

/** Returns the current HEAD SHA, or undefined when no usable HEAD exists. */
export async function getCurrentHeadRevision(repositoryPath?: string): Promise<string | undefined> {
  const repositoryRoot = resolveRepoRoot(repositoryPath).root;

  try {
    const revision = (await simpleGit(repositoryRoot).revparse(['HEAD'])).trim();
    return revision || undefined;
  } catch {
    return undefined;
  }
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

export async function getRecentCommits(
  repositoryPath?: string,
  maxCount: number = 10,
): Promise<RepositoryCommit[]> {
  const repositoryRoot = resolveRepoRoot(repositoryPath).root;
  const repositoryGit = simpleGit(repositoryRoot);

  let status;
  try {
    status = await repositoryGit.status();
  } catch (error) {
    if (error instanceof Error && /not a git repository/i.test(error.message)) {
      throw new Error('Not a git repository. Please run gritch inside a git project.');
    }
    throw error;
  }

  try {
    const result = await repositoryGit.log({ maxCount });
    return result.all.map((commit) => ({
      hash: commit.hash,
      author: commit.author_name,
      date: commit.date,
      subject: commit.message.trim(),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isKnownUnbornError = /does not have any commits yet|ambiguous argument ['"]?HEAD['"]?/i.test(message);
    if (isKnownUnbornError && !status.detached) {
      try {
        await repositoryGit.revparse(['HEAD']);
      } catch {
        return [];
      }
    }
    throw error;
  }
}

export async function validateRepo(): Promise<void> {
  try {
    await git.status();
  } catch {
    throw new Error('Not a git repository. Please run gritch inside a git project.');
  }
}

export function trimDiff(diff: string, maxChars: number = 6000): string {
  if (diff.length <= maxChars) return diff;
  return diff.slice(0, maxChars) + "\n... [diff trimmed for review]";
}
