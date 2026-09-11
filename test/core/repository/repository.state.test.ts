import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { statusMock, revparseMock, rawMock, simpleGitMock } = vi.hoisted(() => {
  const statusMock = vi.fn();
  const revparseMock = vi.fn();
  const rawMock = vi.fn();
  const simpleGitMock = vi.fn(() => ({
    status: statusMock,
    revparse: revparseMock,
    raw: rawMock,
  }));
  return { statusMock, revparseMock, rawMock, simpleGitMock };
});

vi.mock('simple-git', () => ({
  default: simpleGitMock,
}));

import {
  createRepositoryStatusFingerprint,
  CURRENT_INSPECTION_VERSION,
  observeRepositoryState,
  type RepositoryStatus,
} from '../../../src/core/repository/repository.state';

const temporaryRoots: string[] = [];

function makeRoot(withGit = true): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-state-'));
  temporaryRoots.push(root);
  if (withGit) fs.mkdirSync(path.join(root, '.git'));
  return root;
}

function cleanStatus() {
  return {
    staged: [],
    modified: [],
    not_added: [],
    deleted: [],
    renamed: [],
    conflicted: [],
    files: [],
    current: 'main',
    tracking: null,
    ahead: 0,
    behind: 0,
    detached: false,
    isClean: () => true,
  };
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    fs.rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  statusMock.mockResolvedValue(cleanStatus());
  revparseMock.mockResolvedValue('head-sha');
  rawMock.mockResolvedValue('refs/heads/main');
});

describe('observeRepositoryState', () => {
  it('observes a clean repository and canonicalizes nested paths', async () => {
    const root = makeRoot();
    const nested = path.join(root, 'src', 'deep');
    fs.mkdirSync(nested, { recursive: true });

    const state = await observeRepositoryState(nested);

    expect(state.identity.root).toBe(path.resolve(root));
    expect(state.worktreeState).toBe('clean');
    expect(state.headRevision).toBe('head-sha');
    expect(state.status.entries).toEqual([]);
    expect(state.inspectionVersion).toBe(CURRENT_INSPECTION_VERSION);
    expect(simpleGitMock).toHaveBeenCalledWith(path.resolve(root));
  });

  it.each([
    ['modified', { modified: ['file.txt'], files: [{ path: 'file.txt', index: ' ', working_dir: 'M' }] }],
    ['staged', { staged: ['file.txt'], files: [{ path: 'file.txt', index: 'M', working_dir: ' ' }] }],
    ['untracked', { not_added: ['new.txt'], files: [{ path: 'new.txt', index: '?', working_dir: '?' }] }],
    ['deleted', { deleted: ['file.txt'], files: [{ path: 'file.txt', index: ' ', working_dir: 'D' }] }],
    ['renamed', {
      renamed: [{ from: 'file.txt', to: 'renamed.txt' }],
      files: [{ path: 'renamed.txt', from: 'file.txt', index: 'R', working_dir: ' ' }],
    }],
    ['conflicted', { conflicted: ['file.txt'], files: [{ path: 'file.txt', index: 'U', working_dir: 'U' }] }],
  ])('reports a %s worktree and changes the status fingerprint', async (_name, changes) => {
    const root = makeRoot();
    const clean = await observeRepositoryState(root);
    statusMock.mockResolvedValue({ ...cleanStatus(), ...changes });

    const changed = await observeRepositoryState(root);

    expect(changed.worktreeState).toBe('dirty');
    expect(changed.status.fingerprint).not.toBe(clean.status.fingerprint);
  });

  it('observes an unborn repository without fabricating a HEAD revision', async () => {
    const root = makeRoot();
    revparseMock.mockRejectedValue(new Error(
      "fatal: your current branch 'main' does not have any commits yet",
    ));

    const state = await observeRepositoryState(root);

    expect(state.worktreeState).toBe('unborn');
    expect(state.headRevision).toBeUndefined();
    expect(rawMock).toHaveBeenCalledWith(['symbolic-ref', '--quiet', 'HEAD']);
  });

  it('supports detached HEAD', async () => {
    const root = makeRoot();
    statusMock.mockResolvedValue({ ...cleanStatus(), detached: true, current: null });

    const state = await observeRepositoryState(root);

    expect(state.worktreeState).toBe('detached');
    expect(state.headRevision).toBe('head-sha');
  });

  it('distinguishes a non-Git directory', async () => {
    const root = makeRoot(false);

    const state = await observeRepositoryState(root);

    expect(state.worktreeState).toBe('non-git');
    expect(state.headRevision).toBeUndefined();
    expect(simpleGitMock).not.toHaveBeenCalled();
  });

  it('produces the same fingerprint regardless of status ordering', () => {
    const first: Omit<RepositoryStatus, 'fingerprint'> = {
      staged: ['b.txt', 'a.txt'],
      modified: ['modified.txt'],
      untracked: ['new.txt'],
      deleted: [],
      renamed: [{ from: 'old.txt', to: 'new.txt' }],
      conflicted: ['conflict.txt'],
      entries: [
        { path: 'b.txt', index: 'M', workingTree: ' ' },
        { path: 'a.txt', index: 'M', workingTree: ' ' },
      ],
    };
    const second: Omit<RepositoryStatus, 'fingerprint'> = {
      ...first,
      staged: [...first.staged].reverse(),
      entries: [...first.entries].reverse(),
    };

    expect(createRepositoryStatusFingerprint(first)).toBe(createRepositoryStatusFingerprint(second));
  });

  it('does not classify an unexpected HEAD error as unborn', async () => {
    const root = makeRoot();
    const error = new Error('permission denied');
    revparseMock.mockRejectedValue(error);

    await expect(observeRepositoryState(root)).rejects.toBe(error);
    expect(rawMock).not.toHaveBeenCalled();
  });

  it('does not classify a broken repository as unborn when status fails', async () => {
    const root = makeRoot();
    const error = new Error('fatal: not a git repository');
    statusMock.mockRejectedValue(error);

    await expect(observeRepositoryState(root)).rejects.toBe(error);
  });
});
