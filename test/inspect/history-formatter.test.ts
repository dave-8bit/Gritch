import { describe, expect, it } from 'vitest';

import { formatRepositoryHistory } from '../../src/inspect/formatter';
import type { RepositoryCommit } from '../../src/utils/git';

describe('repository history formatter', () => {
  const commits: RepositoryCommit[] = [
    {
      hash: 'abcdef1234567890',
      author: 'Alice',
      date: '2026-09-07T18:00:00+01:00',
      subject: 'fix: quote "value" `path`\t✓',
    },
    {
      hash: '1234567890abcdef',
      author: 'Bob',
      date: '2026-09-07T17:00:00+01:00',
      subject: 'feat: add history',
    },
  ];

  it('formats history deterministically with abbreviated hashes', () => {
    const expected = [
      'Repository History',
      '  Root: C:\\repo',
      '  Commits: 2',
      '',
      '  abcdef1  2026-09-07T18:00:00+01:00  Alice',
      '    fix: quote "value" `path`\t✓',
      '  1234567  2026-09-07T17:00:00+01:00  Bob',
      '    feat: add history',
    ].join('\n');

    expect(formatRepositoryHistory('C:\\repo', commits)).toBe(expected);
    expect(formatRepositoryHistory('C:\\repo', commits)).toBe(expected);
  });

  it('formats empty history explicitly', () => {
    expect(formatRepositoryHistory('C:\\repo', [])).toBe(
      ['Repository History', '  Root: C:\\repo', '  Commits: 0', '', '  (no commits)'].join('\n'),
    );
  });
});
