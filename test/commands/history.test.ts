import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/git', () => ({
  getRecentCommits: vi.fn(),
}));
vi.mock('../../src/inspect/formatter', () => ({
  formatRepositoryHistory: vi.fn(),
}));
vi.mock('../../src/inspect/root', () => ({
  resolveRepoRoot: vi.fn(),
}));
vi.mock('../../src/utils/display', () => ({
  printError: vi.fn(),
}));

import { getRecentCommits } from '../../src/utils/git';
import { formatRepositoryHistory } from '../../src/inspect/formatter';
import { resolveRepoRoot } from '../../src/inspect/root';
import { printError } from '../../src/utils/display';
import { historyCommand } from '../../src/commands/history';

describe('history command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRecentCommits).mockResolvedValue([]);
    vi.mocked(resolveRepoRoot).mockReturnValue({ root: 'C:/repo' });
    vi.mocked(formatRepositoryHistory).mockReturnValue('history output');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('forwards an omitted root and uses the fixed default count', async () => {
    await historyCommand();

    expect(getRecentCommits).toHaveBeenCalledWith(undefined, 10);
    expect(resolveRepoRoot).toHaveBeenCalledWith(undefined);
    expect(formatRepositoryHistory).toHaveBeenCalledWith('C:/repo', []);
    expect(console.log).toHaveBeenCalledWith('history output');
  });

  it('forwards an explicit root and prints empty history output', async () => {
    await historyCommand('C:/repo');

    expect(getRecentCommits).toHaveBeenCalledWith('C:/repo', 10);
    expect(formatRepositoryHistory).toHaveBeenCalledWith('C:/repo', []);
  });

  it('surfaces repository and unexpected Git errors', async () => {
    vi.mocked(getRecentCommits).mockRejectedValueOnce(new Error('Not a git repository.'));
    await historyCommand('C:/not-a-repo');
    expect(printError).toHaveBeenCalledWith('Not a git repository.');

    vi.mocked(printError).mockClear();
    vi.mocked(getRecentCommits).mockRejectedValueOnce(new Error('git process failed'));
    await historyCommand('C:/repo');
    expect(printError).toHaveBeenCalledWith('git process failed');
  });
});
