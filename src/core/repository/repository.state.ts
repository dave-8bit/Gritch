import { createHash } from 'node:crypto';
import simpleGit, { type StatusResult } from 'simple-git';

import { resolveRepositoryIdentity, type RepositoryIdentity } from './repository.identity';
import { resolveRepoRoot } from '../../inspect/root';

export const CURRENT_INSPECTION_VERSION = 1;

export type RepositoryWorktreeState =
  | 'clean'
  | 'dirty'
  | 'unborn'
  | 'detached'
  | 'non-git';

export interface RepositoryStatusEntry {
  path: string;
  index: string;
  workingTree: string;
  from?: string;
}

export interface RepositoryStatus {
  staged: string[];
  modified: string[];
  untracked: string[];
  deleted: string[];
  renamed: Array<{ from: string; to: string }>;
  conflicted: string[];
  entries: RepositoryStatusEntry[];
  fingerprint: string;
}

export interface RepositoryState {
  identity: RepositoryIdentity;
  headRevision?: string;
  worktreeState: RepositoryWorktreeState;
  status: RepositoryStatus;
  inspectionVersion: number;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function normalizeStatus(status: StatusResult): Omit<RepositoryStatus, 'fingerprint'> {
  const entries = status.files
    .map((file) => ({
      path: file.path,
      index: file.index,
      workingTree: file.working_dir,
      ...(file.from ? { from: file.from } : {}),
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

  return {
    staged: sortedUnique(status.staged),
    modified: sortedUnique(status.modified),
    untracked: sortedUnique(status.not_added),
    deleted: sortedUnique(status.deleted),
    renamed: status.renamed
      .map(({ from, to }) => ({ from, to }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    conflicted: sortedUnique(status.conflicted),
    entries,
  };
}

/**
 * Creates a deterministic dirty-state signal from normalized Git status data.
 * This is not a content identity and does not hash repository files.
 */
export function createRepositoryStatusFingerprint(status: Omit<RepositoryStatus, 'fingerprint'>): string {
  const canonical = JSON.stringify({
    staged: [...status.staged].sort(),
    modified: [...status.modified].sort(),
    untracked: [...status.untracked].sort(),
    deleted: [...status.deleted].sort(),
    renamed: [...status.renamed].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    conflicted: [...status.conflicted].sort(),
    entries: [...status.entries].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  });

  return createHash('sha256').update(canonical).digest('hex');
}

function toRepositoryStatus(status: StatusResult): RepositoryStatus {
  const normalized = normalizeStatus(status);
  return {
    ...normalized,
    fingerprint: createRepositoryStatusFingerprint(normalized),
  };
}

function isMissingHeadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  return (
    /your current branch ['"].+['"] does not have any commits yet/i.test(error.message) ||
    /ambiguous argument ['"]HEAD['"]/i.test(error.message)
  );
}

function isDirty(status: RepositoryStatus): boolean {
  return status.entries.length > 0 ||
    status.staged.length > 0 ||
    status.modified.length > 0 ||
    status.untracked.length > 0 ||
    status.deleted.length > 0 ||
    status.renamed.length > 0 ||
    status.conflicted.length > 0;
}

/**
 * Observes repository state without changing Git, the filesystem, or process CWD.
 */
export async function observeRepositoryState(inputPath?: string): Promise<RepositoryState> {
  const { root: resolvedRoot, evidence } = resolveRepoRoot(inputPath);
  const identity = resolveRepositoryIdentity(resolvedRoot);
  const root = identity.root;

  if (!evidence) {
    return {
      identity,
      worktreeState: 'non-git',
      status: {
        staged: [],
        modified: [],
        untracked: [],
        deleted: [],
        renamed: [],
        conflicted: [],
        entries: [],
        fingerprint: createRepositoryStatusFingerprint({
          staged: [],
          modified: [],
          untracked: [],
          deleted: [],
          renamed: [],
          conflicted: [],
          entries: [],
        }),
      },
      inspectionVersion: CURRENT_INSPECTION_VERSION,
    };
  }

  const repositoryGit = simpleGit(root);
  const gitStatus = await repositoryGit.status();
  const status = toRepositoryStatus(gitStatus);

  let headRevision: string | undefined;
  try {
    headRevision = (await repositoryGit.revparse(['HEAD'])).trim() || undefined;
  } catch (error) {
    if (gitStatus.detached || !isMissingHeadError(error)) {
      throw error;
    }

    const headReference = (await repositoryGit.raw(['symbolic-ref', '--quiet', 'HEAD'])).trim();
    if (!headReference.startsWith('refs/heads/')) {
      throw error;
    }

    return {
      identity,
      worktreeState: 'unborn',
      status,
      inspectionVersion: CURRENT_INSPECTION_VERSION,
    };
  }

  return {
    identity,
    headRevision,
    worktreeState: gitStatus.detached ? 'detached' : isDirty(status) ? 'dirty' : 'clean',
    status,
    inspectionVersion: CURRENT_INSPECTION_VERSION,
  };
}
