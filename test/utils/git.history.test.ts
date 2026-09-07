import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { statusMock, logMock, revparseMock, simpleGitMock } = vi.hoisted(() => {
  const statusMock = vi.fn();
  const logMock = vi.fn();
  const revparseMock = vi.fn();
  const simpleGitMock = vi.fn(() => ({
    status: statusMock,
    log: logMock,
    revparse: revparseMock,
  }));
  return { statusMock, logMock, revparseMock, simpleGitMock };
});

vi.mock('simple-git', () => ({
  default: simpleGitMock,
}));

import { getRecentCommits } from '../../src/utils/git';

describe('getRecentCommits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statusMock.mockResolvedValue({ current: 'main', detached: false });
    revparseMock.mockResolvedValue('abc123');
  });

  it('maps scoped log records and preserves Git ordering', async () => {
    logMock.mockResolvedValue({
      all: [
        {
          hash: 'abcdef1234567890',
          author_name: 'Alice',
          date: '2026-09-07T18:00:00+01:00',
          message: ' first subject',
        },
        {
          hash: '1234567890abcdef',
          author_name: 'Bob',
          date: '2026-09-07T17:00:00+01:00',
          message: 'second subject',
        },
      ],
    });

    await expect(getRecentCommits('C:/repo')).resolves.toEqual([
      {
        hash: 'abcdef1234567890',
        author: 'Alice',
        date: '2026-09-07T18:00:00+01:00',
        subject: 'first subject',
      },
      {
        hash: '1234567890abcdef',
        author: 'Bob',
        date: '2026-09-07T17:00:00+01:00',
        subject: 'second subject',
      },
    ]);
    expect(simpleGitMock).toHaveBeenLastCalledWith(path.resolve('C:/repo'));
    expect(logMock).toHaveBeenCalledWith({ maxCount: 10 });
  });

  it('uses an explicit commit count', async () => {
    logMock.mockResolvedValue({ all: [] });

    await expect(getRecentCommits('C:/repo', 3)).resolves.toEqual([]);
    expect(logMock).toHaveBeenCalledWith({ maxCount: 3 });
  });

  it('resolves a nested path to the repository root', async () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-history-'));
    const nestedPath = path.join(repositoryRoot, 'src');
    fs.mkdirSync(nestedPath);
    fs.mkdirSync(path.join(repositoryRoot, '.git'));
    logMock.mockResolvedValue({ all: [] });

    await expect(getRecentCommits(nestedPath)).resolves.toEqual([]);
    expect(simpleGitMock).toHaveBeenLastCalledWith(repositoryRoot);
  });

  it('returns an empty list for an unborn repository', async () => {
    statusMock.mockResolvedValue({ current: null, detached: false });
    logMock.mockRejectedValue(new Error('fatal: your current branch does not have any commits yet'));
    revparseMock.mockRejectedValue(new Error('fatal: ambiguous argument HEAD'));

    await expect(getRecentCommits('C:/repo')).resolves.toEqual([]);
  });

  it('rejects non-Git directories with the established error', async () => {
    statusMock.mockRejectedValue(new Error('fatal: not a git repository'));

    await expect(getRecentCommits('C:/not-a-repo')).rejects.toThrow(
      'Not a git repository. Please run gritch inside a git project.',
    );
  });

  it('propagates unexpected validation and log failures', async () => {
    const validationError = new Error('permission denied');
    statusMock.mockRejectedValue(validationError);
    await expect(getRecentCommits('C:/repo')).rejects.toBe(validationError);

    statusMock.mockResolvedValue({ current: 'main', detached: false });
    const logError = new Error('git process failed');
    logMock.mockRejectedValue(logError);
    await expect(getRecentCommits('C:/repo')).rejects.toBe(logError);
  });
});
