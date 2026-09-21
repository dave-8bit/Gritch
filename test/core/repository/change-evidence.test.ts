import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import simpleGit from 'simple-git';
import type { SimpleGit } from 'simple-git';

import {
  ChangeEvidenceBuilder,
  computeChangeTotals,
  identityFromStatusEntries,
  parseNameStatus,
  parseNumStat,
  type ChangeFileRecord,
  type ChangeEvidence,
} from '../../../src/core/repository/change-evidence';
import type { RepositoryIdentity } from '../../../src/core/repository/repository.identity';
import type { RepositoryState, RepositoryStatus } from '../../../src/core/repository/repository.state';

function makeIdentity(root = '/repo'): RepositoryIdentity {
  return { root, key: root };
}

function makeStatus(overrides: Partial<RepositoryStatus> = {}): RepositoryStatus {
  return {
    staged: [],
    modified: [],
    untracked: [],
    deleted: [],
    renamed: [],
    conflicted: [],
    entries: [],
    fingerprint: 'fp',
    ...overrides,
  };
}

function makeState(overrides: Partial<RepositoryState> = {}): RepositoryState {
  return {
    identity: makeIdentity(),
    worktreeState: 'dirty',
    status: makeStatus(),
    inspectionVersion: 1,
    ...overrides,
  };
}

interface FakeGit {
  diff: ReturnType<typeof vi.fn>;
}

/**
 * Mocks the builder's Git dependency. The builder issues exactly two `diff`
 * calls, both in `-z` NUL-separated form: one for `--name-status` identity
 * and one for `--numstat` statistics, so the fake dispatches on the flag.
 */
function setup(overrides: {
  state?: RepositoryState;
  nameStatus?: string;
  numStat?: string;
  nameStatusError?: Error;
  numStatError?: Error;
  observeStateError?: Error;
} = {}) {
  const git: FakeGit = { diff: vi.fn() };
  const builder = new ChangeEvidenceBuilder({
    resolveIdentity: () => makeIdentity(),
    observeState: () =>
      overrides.observeStateError
        ? Promise.reject(overrides.observeStateError)
        : Promise.resolve(overrides.state ?? makeState()),
    git: (() => git) as unknown as (baseDir: string) => SimpleGit,
  });

  if (overrides.observeStateError) return { git, builder };
  git.diff.mockImplementation((args: string[]) => {
    if (args.includes('--name-status')) {
      if (overrides.nameStatusError) return Promise.reject(overrides.nameStatusError);
      return Promise.resolve(overrides.nameStatus ?? '');
    }
    if (overrides.numStatError) return Promise.reject(overrides.numStatError);
    return Promise.resolve(overrides.numStat ?? '');
  });

  return { git, builder };
}

describe('parseNameStatus (git diff --name-status -z, NUL-separated)', () => {
  it('parses modified, added, and deleted records', () => {
    const records = parseNameStatus('M\0a.txt\0A\0b.ts\0D\0c.ts\0');
    expect(records).toEqual([
      { status: 'modified', path: 'a.txt' },
      { status: 'added', path: 'b.ts' },
      { status: 'deleted', path: 'c.ts' },
    ]);
  });

  it('parses renames with similarity and previous path', () => {
    expect(parseNameStatus('R100\0src/a.ts\0src/b.ts\0')).toEqual([
      { status: 'renamed', path: 'src/b.ts', previousPath: 'src/a.ts', similarity: 100 },
    ]);
  });

  it('parses copies with similarity', () => {
    expect(parseNameStatus('C75\0x.ts\0y.ts\0')).toEqual([
      { status: 'copied', path: 'y.ts', previousPath: 'x.ts', similarity: 75 },
    ]);
  });

  it('parses type-change, unmerged, unknown, and broken codes', () => {
    const records = parseNameStatus('T\0f.ts\0U\0g.ts\0X\0h.ts\0B\0i.ts\0');
    expect(records.map((r) => r.status)).toEqual([
      'type-changed',
      'unmerged',
      'unknown',
      'unknown',
    ]);
  });

  it('drops a truncated rename record without a new path', () => {
    expect(parseNameStatus('R50\0onlyOldPath\0')).toEqual([]);
  });

  it('handles empty input and stray/trailing NULs', () => {
    expect(parseNameStatus('')).toEqual([]);
    expect(parseNameStatus('\0\0M\0a.ts\0\0')).toEqual([
      { status: 'modified', path: 'a.ts' },
    ]);
  });

  it('emits paths verbatim: spaces, tabs, quotes, backslashes, and non-ASCII are preserved', () => {
    // With -z, git never quotes or escapes; every byte between NULs is the path.
    const records = parseNameStatus(
      'A\0dir with space/caf\u00e9.ts\0' +
      'M\0pa\th.ts\0' +
      'A\0we"ird\\path.ts\0' +
      'A\0 trailing spaces \0',
    );
    expect(records).toEqual([
      { status: 'added', path: 'dir with space/caf\u00e9.ts' },
      { status: 'modified', path: 'pa\th.ts' },
      { status: 'added', path: 'we"ird\\path.ts' },
      { status: 'added', path: ' trailing spaces ' },
    ]);
  });
});

describe('parseNumStat (git diff --numstat -z, NUL-separated)', () => {
  it('maps text file statistics by normalized path', () => {
    const map = parseNumStat('2\t1\tsrc/a.ts\0');
    expect(map.get('src/a.ts')).toEqual({
      insertions: 2,
      deletions: 1,
      changes: 3,
      binary: false,
    });
  });

  it('keeps binary records with zero counts', () => {
    const map = parseNumStat('-\t-\timg.png\0');
    expect(map.get('img.png')).toEqual({
      insertions: 0,
      deletions: 0,
      changes: 0,
      binary: true,
    });
  });

  it('joins the rename form (<ins><TAB><del><TAB><NUL>old<NUL>new) to the new path', () => {
    const map = parseNumStat('1\t0\t\0src/a.ts\0src/b.ts\0');
    expect(map.has('src/b.ts')).toBe(true);
    expect(map.has('src/a.ts')).toBe(false);
    expect(map.get('src/b.ts')).toEqual({ insertions: 1, deletions: 0, changes: 1, binary: false });
  });

  it('joins zero-change rename records with genuine zeros', () => {
    const map = parseNumStat('0\t0\t\0src/a.ts\0src/b.ts\0');
    expect(map.get('src/b.ts')).toEqual({ insertions: 0, deletions: 0, changes: 0, binary: false });
  });

  it('preserves tabs inside paths (everything after the second tab is the path)', () => {
    const map = parseNumStat('2\t1\tpa\th.ts\0');
    expect(map.get('pa\th.ts')).toEqual({ insertions: 2, deletions: 1, changes: 3, binary: false });
  });

  it('preserves spaces, quotes, and non-ASCII in paths through normalization', () => {
    const map = parseNumStat('3\t0\tdir with space/caf\u00e9.ts\0' + '4\t1\twe"ird\\x.ts\0');
    expect(map.has('dir with space/caf\u00e9.ts')).toBe(true);
    // A literal double quote survives verbatim. A literal backslash is folded
    // to the repository separator by normalizeRepositoryPath, exactly as for
    // every other path source (Windows-style input included), so path identity
    // stays consistent across name-status, numstat, status, and the file index.
    expect(map.get('we"ird/x.ts')).toEqual({
      insertions: 4,
      deletions: 1,
      changes: 5,
      binary: false,
    });
  });

  it('normalizes separators and dot segments on the decoded path', () => {
    const map = parseNumStat('1\t0\t./src\\a.ts\0');
    expect([...map.keys()]).toEqual(['src/a.ts']);
  });

  it('handles empty input and drops malformed records', () => {
    expect(parseNumStat('').size).toBe(0);
    expect(parseNumStat('\0\0').size).toBe(0);
    // No tabs / only one count field / truncated rename form are malformed.
    expect(parseNumStat('garbage\0a.ts\0').size).toBe(0);
    expect(parseNumStat('1\t\0a.ts\0').size).toBe(0);
    expect(parseNumStat('1\t1\t\0only-old\0').size).toBe(0);
    expect(parseNumStat('x\ty\ta.ts\0').size).toBe(0);
  });

  it('keeps a genuine zero-change record distinguishable from a missing one', () => {
    const map = parseNumStat('0\t0\tmode-only.ts\0');
    expect(map.has('mode-only.ts')).toBe(true);
    expect(map.get('mode-only.ts')).toEqual({ insertions: 0, deletions: 0, changes: 0, binary: false });
  });
});

describe('identityFromStatusEntries', () => {
  it('maps index codes and skips unstaged/untracked entries', () => {
    const identities = identityFromStatusEntries([
      { path: 'a.ts', index: 'M', workingTree: ' ' },
      { path: 'b.ts', index: 'A', workingTree: ' ' },
      { path: 'c.ts', index: '?', workingTree: '?' },
      { path: 'd.ts', index: ' ', workingTree: 'M' },
    ]);
    expect(identities).toEqual([
      { status: 'modified', path: 'a.ts' },
      { status: 'added', path: 'b.ts' },
    ]);
  });

  it('maps renames, copies, and unmerged entries', () => {
    const identities = identityFromStatusEntries([
      { path: 'new.ts', index: 'R', workingTree: ' ', from: 'old.ts' },
      { path: 'copy.ts', index: 'C', workingTree: ' ', from: 'orig.ts' },
      { path: 'both.ts', index: 'U', workingTree: 'U' },
    ]);
    expect(identities).toEqual([
      { status: 'renamed', path: 'new.ts', previousPath: 'old.ts' },
      { status: 'copied', path: 'copy.ts', previousPath: 'orig.ts' },
      { status: 'unmerged', path: 'both.ts' },
    ]);
  });
});

describe('computeChangeTotals', () => {
  it('aggregates counts, binaries, and a complete byStatus map', () => {
    const totals = computeChangeTotals([
      recordWith({ path: 'a.ts', status: 'added', insertions: 2 }),
      recordWith({ path: 'b.ts', status: 'modified', deletions: 1, insertions: 0 }),
      recordWith({ path: 'img.png', status: 'added', binary: true, insertions: 0 }),
    ]);
    expect(totals.files).toBe(3);
    expect(totals.insertions).toBe(2);
    expect(totals.deletions).toBe(1);
    expect(totals.binaryFiles).toBe(1);
    expect(totals.lineCountsAvailable).toBe(true);
    expect(totals.filesMissingLineCounts).toBe(0);
    expect(totals.unmatchedStatisticsFiles).toBe(0);
    expect(totals.byStatus.added).toBe(2);
    expect(totals.byStatus.modified).toBe(1);
    expect(totals.byStatus.deleted).toBe(0);
    expect(Object.keys(totals.byStatus)).toHaveLength(8);
  });

  it('reports strict line-count completeness and missing-file counts', () => {
    const totals = computeChangeTotals([
      recordWith({ path: 'a.ts', insertions: 2 }),
      recordWith({ path: 'b.ts', lineCountsAvailable: false }),
    ], 1);
    expect(totals.lineCountsAvailable).toBe(false);
    expect(totals.filesMissingLineCounts).toBe(1);
    expect(totals.unmatchedStatisticsFiles).toBe(1);
    // Vacuous completeness for an empty change set.
    expect(computeChangeTotals([]).lineCountsAvailable).toBe(true);
  });
});

function recordWith(overrides: Partial<ChangeFileRecord>): ChangeFileRecord {
  return {
    path: 'a.ts',
    status: 'modified',
    lineCountsAvailable: true,
    insertions: 1,
    deletions: 0,
    changes: 1,
    binary: false,
    extension: '.ts',
    category: 'source',
    subsystem: 'a.ts',
    conflicted: false,
    ...overrides,
  };
}

describe('ChangeEvidenceBuilder (unit, mocked git)', () => {
  it('builds full-fidelity evidence for a single modified source file', async () => {
    const { builder } = setup({
      nameStatus: 'M\0src/app.ts\0',
      numStat: '2\t1\tsrc/app.ts\0',
    });

    const evidence = await builder.build();

    expect(evidence.schemaVersion).toBe(1);
    expect(evidence.files).toHaveLength(1);
    const file = evidence.files[0];
    expect(file).toMatchObject({
      path: 'src/app.ts',
      status: 'modified',
      lineCountsAvailable: true,
      insertions: 2,
      deletions: 1,
      changes: 3,
      binary: false,
      extension: '.ts',
      category: 'source',
      subsystem: 'src',
      conflicted: false,
    });
    expect(evidence.identitySource).toBe('staged-diff');
    expect(evidence.degradations).toEqual([]);
    expect(evidence.totals).toMatchObject({
      lineCountsAvailable: true,
      filesMissingLineCounts: 0,
      unmatchedStatisticsFiles: 0,
      files: 1,
      insertions: 2,
      deletions: 1,
      binaryFiles: 0,
    });
    expect(evidence.totals.byStatus.modified).toBe(1);
    expect(evidence.repository).toEqual({ root: '/repo', key: '/repo', worktreeState: 'dirty' });
    expect(evidence.signals.sourceCodeChanges).toBe(true);
    expect(evidence.tier).toBe('moderate');
  });

  it('issues both -z reads through the Git dependency (quoting-immune representation)', async () => {
    const { git, builder } = setup({
      nameStatus: 'M\0src/app.ts\0',
      numStat: '2\t1\tsrc/app.ts\0',
    });
    await builder.build();
    expect(git.diff).toHaveBeenCalledWith(['--cached', '--name-status', '-M', '-C', '-z']);
    expect(git.diff).toHaveBeenCalledWith(['--cached', '--numstat', '-M', '-C', '-z']);
  });

  it('reports an added source file', async () => {
    const { builder } = setup({
      nameStatus: 'A\0src/new.ts\0',
      numStat: '5\t0\tsrc/new.ts\0',
    });
    const evidence = await builder.build();
    expect(evidence.files[0].status).toBe('added');
    expect(evidence.totals.insertions).toBe(5);
  });

  it('reports a deleted source file and escalates the tier', async () => {
    const { builder } = setup({
      nameStatus: 'D\0src/old.ts\0',
      numStat: '0\t4\tsrc/old.ts\0',
    });
    const evidence = await builder.build();
    expect(evidence.files[0].status).toBe('deleted');
    expect(evidence.signals.deletedSourceFiles).toEqual(['src/old.ts']);
    expect(evidence.tier).toBe('high');
  });

  it('joins rename statistics to the new path', async () => {
    const { builder } = setup({
      nameStatus: 'R100\0src/a.ts\0src/b.ts\0',
      numStat: '0\t0\t\0src/a.ts\0src/b.ts\0',
    });
    const evidence = await builder.build();
    expect(evidence.files[0]).toMatchObject({
      path: 'src/b.ts',
      previousPath: 'src/a.ts',
      status: 'renamed',
      similarity: 100,
      lineCountsAvailable: true,
      insertions: 0,
    });
    expect(evidence.degradations).toEqual([]);
  });

  it('aggregates mixed categories and sorts paths deterministically', async () => {
    const { builder } = setup({
      nameStatus: 'M\0src/app.ts\0M\0test/app.test.ts\0M\0config/gritch.config.json\0',
      numStat: '1\t0\tsrc/app.ts\0' + '1\t0\ttest/app.test.ts\0' + '1\t0\tconfig/gritch.config.json\0',
    });
    const evidence = await builder.build();
    expect(evidence.files.map((f) => f.path)).toEqual([
      'config/gritch.config.json',
      'src/app.ts',
      'test/app.test.ts',
    ]);
    expect(evidence.files.map((f) => f.category)).toEqual(['config', 'source', 'test']);
    expect(evidence.totals.files).toBe(3);
    expect(evidence.totals.byStatus.modified).toBe(3);
    expect(evidence.signals.testOnlyChange).toBe(false);
  });

  it('returns an empty trivial packet for no staged change', async () => {
    const { builder } = setup({ nameStatus: '' });
    const evidence = await builder.build();
    expect(evidence.files).toEqual([]);
    expect(evidence.totals.files).toBe(0);
    expect(evidence.tier).toBe('trivial');
    expect(evidence.tierReasons).toEqual(['no staged changes']);
  });

  it('returns empty evidence for a non-Git directory without consulting git', async () => {
    const { git, builder } = setup({ state: makeState({ worktreeState: 'non-git' }) });
    const evidence = await builder.build();
    expect(evidence.files).toEqual([]);
    expect(evidence.repository.worktreeState).toBe('non-git');
    expect(evidence.tierReasons).toEqual(['non-git repository']);
    expect(evidence.identitySource).toBe('none');
    expect(evidence.degradations).toEqual([]);
    expect(git.diff).not.toHaveBeenCalled();
  });

  it('propagates broken repository state errors', async () => {
    const { builder } = setup({ observeStateError: new Error('fatal: not a git repository') });
    await expect(builder.build()).rejects.toThrow('fatal: not a git repository');
  });
  it('reports binary files with zero counts and never fabricates', async () => {
    const { builder } = setup({
      nameStatus: 'A\0assets/logo.png\0',
      numStat: '-\t-\tassets/logo.png\0',
    });
    const evidence = await builder.build();
    expect(evidence.files[0]).toMatchObject({
      path: 'assets/logo.png',
      status: 'added',
      binary: true,
      lineCountsAvailable: true,
      insertions: 0,
      deletions: 0,
      category: 'unknown',
    });
    expect(evidence.totals.binaryFiles).toBe(1);
  });

  it('records staged copies as added under -C without pretending stronger detection', async () => {
    const { builder } = setup({
      nameStatus: 'A\0copy.ts\0',
      numStat: '3\t0\tcopy.ts\0',
    });
    const evidence = await builder.build();
    expect(evidence.files[0].status).toBe('added');
  });

  it('builds full evidence with real line counts for an unborn repository', async () => {
    const { builder } = setup({
      state: makeState({ worktreeState: 'unborn', headRevision: undefined }),
      nameStatus: 'A\0first.ts\0',
      numStat: '1\t0\tfirst.ts\0',
    });
    const evidence = await builder.build();
    expect(evidence.repository.worktreeState).toBe('unborn');
    expect(evidence.files[0]).toMatchObject({ path: 'first.ts', status: 'added', insertions: 1 });
    expect(evidence.totals.lineCountsAvailable).toBe(true);
  });

  it('falls back to status entries and reports both degradations when the staged diff fails', async () => {
    const { builder } = setup({
      state: makeState({
        status: makeStatus({
          entries: [{ path: 'staged.ts', index: 'A', workingTree: ' ' }],
          staged: ['staged.ts'],
        }),
      }),
      nameStatusError: new Error('fatal: ambiguous argument HEAD'),
    });
    const evidence = await builder.build();
    expect(evidence.files).toHaveLength(1);
    expect(evidence.files[0].path).toBe('staged.ts');
    expect(evidence.files[0].status).toBe('added');
    expect(evidence.identitySource).toBe('repository-status');
    expect(evidence.degradations).toEqual([
      'identity-from-repository-status',
      'line-statistics-unavailable',
    ]);
    expect(evidence.totals.lineCountsAvailable).toBe(false);
    expect(evidence.totals.filesMissingLineCounts).toBe(1);
    expect(evidence.totals.insertions).toBe(0);
  });

  it('reports unavailable statistics but keeps identities when only the numstat read fails', async () => {
    const { builder } = setup({
      nameStatus: 'M\0src/a.ts\0',
      numStatError: new Error('summary failed'),
    });
    const evidence = await builder.build();
    expect(evidence.files[0]).toMatchObject({
      path: 'src/a.ts',
      status: 'modified',
      lineCountsAvailable: false,
      insertions: 0,
    });
    expect(evidence.identitySource).toBe('staged-diff');
    expect(evidence.degradations).toEqual(['line-statistics-unavailable']);
    expect(evidence.totals.lineCountsAvailable).toBe(false);
    expect(evidence.totals.filesMissingLineCounts).toBe(1);
    expect(evidence.totals.unmatchedStatisticsFiles).toBe(0);
  });

  it('marks conflicted paths from repository status', async () => {
    const { builder } = setup({
      nameStatus: 'U\0both.ts\0',
      // Verified against git 2.51: unmerged paths do get a 0/0 numstat record.
      numStat: '0\t0\tboth.ts\0',
      state: makeState({
        status: makeStatus({ conflicted: ['both.ts'] }),
      }),
    });
    const evidence = await builder.build();
    expect(evidence.files[0].conflicted).toBe(true);
    expect(evidence.files[0].status).toBe('unmerged');
    expect(evidence.degradations).toEqual([]);
  });

  it('flags dependency and package-metadata signals on package.json changes', async () => {
    const { builder } = setup({
      nameStatus: 'M\0package.json\0',
      numStat: '1\t1\tpackage.json\0',
    });
    const evidence = await builder.build();
    expect(evidence.files[0].category).toBe('dependency');
    expect(evidence.signals.dependencyChanges).toBe(true);
    expect(evidence.signals.packageMetadataChanges).toBe(true);
    expect(evidence.tier).toBe('high');
  });

  it('produces deep-equal packets for two consecutive builds (determinism, no timestamps)', async () => {
    const { builder } = setup({
      nameStatus: 'M\0src/a.ts\0A\0package.json\0D\0old.md\0',
      numStat: '2\t1\tsrc/a.ts\0' + '1\t0\tpackage.json\0' + '0\t1\told.md\0',
    });
    const first = await builder.build();
    const second = await builder.build();
    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toMatch(/capturedAt|timestamp/i);
  });

  it('normalizes Windows-style and dotted paths from git output', async () => {
    const { builder } = setup({
      nameStatus: 'M\0./src/a.ts\0',
      numStat: '1\t0\tsrc\\a.ts\0',
    });
    const evidence = await builder.build();
    expect(evidence.files[0].path).toBe('src/a.ts');
    expect(evidence.files[0].lineCountsAvailable).toBe(true);
  });

  it('joins a non-ASCII path verbatim instead of a C-quoted key (regression: P1 quoted paths)', async () => {
    const { builder } = setup({
      nameStatus: 'A\0src/caf\u00e9.ts\0',
      numStat: '3\t1\tsrc/caf\u00e9.ts\0',
    });
    const evidence = await builder.build();
    expect(evidence.files[0]).toMatchObject({
      path: 'src/caf\u00e9.ts',
      lineCountsAvailable: true,
      insertions: 3,
      deletions: 1,
      extension: '.ts',
    });
    expect(evidence.degradations).toEqual([]);
  });

  it('exposes a statistics join miss instead of presenting zeros as genuine (regression: P2 join)', async () => {
    // The reviewed failure shape, reproduced synthetically: a statistics record
    // whose normalized key does not equal the authoritative path (a C-quoted
    // key is impossible under `-z`, so this asserts the contract that protects
    // any future divergence between the two reads). The packet must never
    // present this as a genuine zero-change file.
    const { builder } = setup({
      nameStatus: 'A\0src/caf\u00e9.ts\0',
      numStat: '3\t1\t"src/caf\\303\\251.ts"\0',
    });
    const evidence = await builder.build();
    expect(evidence.files[0]).toMatchObject({
      path: 'src/caf\u00e9.ts',
      lineCountsAvailable: false,
      insertions: 0,
      deletions: 0,
    });
    expect(evidence.totals).toMatchObject({
      lineCountsAvailable: false,
      filesMissingLineCounts: 1,
      unmatchedStatisticsFiles: 1,
      insertions: 0,
    });
    expect(evidence.degradations).toEqual(['line-statistics-incomplete']);
  });

  it('keeps a genuine zero-change file distinguishable from a statistics join miss', async () => {
    const { builder } = setup({
      nameStatus: 'M\0mode-only.ts\0R100\0src/a.ts\0src/b.ts\0',
      numStat: '0\t0\tmode-only.ts\0' + '0\t0\t\0src/a.ts\0src/b.ts\0',
    });
    const evidence = await builder.build();
    expect(evidence.files.map((f) => [f.path, f.lineCountsAvailable, f.insertions, f.deletions])).toEqual([
      ['mode-only.ts', true, 0, 0],
      ['src/b.ts', true, 0, 0],
    ]);
    expect(evidence.totals).toMatchObject({
      lineCountsAvailable: true,
      filesMissingLineCounts: 0,
      unmatchedStatisticsFiles: 0,
      insertions: 0,
      deletions: 0,
    });
    expect(evidence.degradations).toEqual([]);
  });

  it('reports unmatched statistics records without attributing their counts', async () => {
    const { builder } = setup({
      nameStatus: 'A\0a.ts\0',
      numStat: '1\t0\ta.ts\0' + '5\t2\tghost.ts\0',
    });
    const evidence = await builder.build();
    // The authoritative per-file totals never absorb the unmatched record.
    expect(evidence.totals.insertions).toBe(1);
    expect(evidence.totals.filesMissingLineCounts).toBe(0);
    expect(evidence.totals.unmatchedStatisticsFiles).toBe(1);
    expect(evidence.degradations).toEqual(['line-statistics-incomplete']);
  });

  it('emits degradations in a deterministic closed-vocabulary order', async () => {
    const { builder } = setup({
      state: makeState({
        status: makeStatus({
          entries: [{ path: 'staged.ts', index: 'A', workingTree: ' ' }],
        }),
      }),
      nameStatusError: new Error('fatal: ambiguous argument HEAD'),
    });
    const first = await builder.build();
    const second = await builder.build();
    expect(first.degradations).toEqual([
      'identity-from-repository-status',
      'line-statistics-unavailable',
    ]);
    expect(first.degradations).toEqual(second.degradations);
  });
});

// ---------------------------------------------------------------------------
// Integration tests with real Git repositories in temporary directories.
// ---------------------------------------------------------------------------

/** Real git subprocesses can exceed the 5s default on loaded Windows machines. */
const GIT_TEST_TIMEOUT = 20_000;

const gitRoots: string[] = [];

function makeGitRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-change-evidence-'));
  gitRoots.push(root);
  return root;
}

function writeRepoFile(root: string, relativePath: string, content: string): void {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

/** Deterministic content with exactly `count` lines so numstat is exact. */
function lines(count: number, prefix = 'line'): string {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`).join('\n') + '\n';
}

async function initRepo(root: string): Promise<SimpleGit> {
  const git = simpleGit(root);
  await git.init();
  await git.addConfig('core.autocrlf', 'false');
  await git.addConfig('user.email', 'gritch-test@example.com');
  await git.addConfig('user.name', 'Gritch Test');
  return git;
}

afterEach(() => {
  // Git child processes can briefly hold directory handles on Windows
  // (EBUSY); retry removal a few times before giving up.
  while (gitRoots.length > 0) {
    const root = gitRoots.pop()!;
    for (let attempt = 0; ; attempt += 1) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
        break;
      } catch {
        if (attempt >= 4) break;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
  }
});

describe('ChangeEvidenceBuilder (integration, real git)', () => {
  it('builds evidence for a real staged modify/add/delete change', async () => {
    const root = makeGitRoot();
    const git = await initRepo(root);
    writeRepoFile(root, 'src/a.ts', lines(5));
    writeRepoFile(root, 'src/c.ts', lines(3));
    await git.add(['.']);
    await git.commit('baseline');

    writeRepoFile(root, 'src/a.ts', 'line 1\nline 6\nline 7\nline 8\n');
    fs.rmSync(path.join(root, 'src/c.ts'));
    writeRepoFile(root, 'src/b.ts', lines(4, 'new'));
    await git.add(['.']);

    const evidence: ChangeEvidence = await new ChangeEvidenceBuilder().build(root);

    expect(evidence.files.map((file) => file.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    const byPath = new Map(evidence.files.map((file) => [file.path, file]));
    expect(byPath.get('src/a.ts')).toMatchObject({ status: 'modified', insertions: 3, deletions: 4 });
    expect(byPath.get('src/b.ts')).toMatchObject({ status: 'added', insertions: 4, deletions: 0 });
    expect(byPath.get('src/c.ts')).toMatchObject({ status: 'deleted', insertions: 0, deletions: 3 });
    expect(evidence.identitySource).toBe('staged-diff');
    expect(evidence.degradations).toEqual([]);
    expect(evidence.totals).toMatchObject({
      lineCountsAvailable: true,
      filesMissingLineCounts: 0,
      unmatchedStatisticsFiles: 0,
      files: 3,
      insertions: 7,
      deletions: 7,
    });
    expect(evidence.tierReasons).toContain('source files deleted');
    expect(evidence.signals.unstagedChangesPresent).toBe(false);
  }, GIT_TEST_TIMEOUT);

  it('joins a real staged rename and edit to the new path', async () => {
    const root = makeGitRoot();
    const git = await initRepo(root);
    writeRepoFile(root, 'src/a.ts', lines(20));
    await git.add(['.']);
    await git.commit('baseline');

    await git.mv('src/a.ts', 'src/b.ts');
    writeRepoFile(root, 'src/b.ts', lines(22));
    await git.add(['.']);

    const evidence = await new ChangeEvidenceBuilder().build(root);

    expect(evidence.files).toHaveLength(1);
    expect(evidence.files[0]).toMatchObject({
      path: 'src/b.ts',
      previousPath: 'src/a.ts',
      status: 'renamed',
      insertions: 2,
      deletions: 0,
    });
    expect(evidence.files[0].similarity).toBeGreaterThan(0);
  }, GIT_TEST_TIMEOUT);
it('reports a real staged binary file with zero counts and no fabricated lines', async () => {
    const root = makeGitRoot();
    const git = await initRepo(root);
    writeRepoFile(root, 'src/keep.ts', lines(2));
    await git.add(['.']);
    await git.commit('baseline');

    // Real binary content (NUL byte) so Git itself classifies the file binary.
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'assets/logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0xff]));
    writeRepoFile(root, 'src/keep.ts', lines(3));
    await git.add(['.']);

    const evidence = await new ChangeEvidenceBuilder().build(root);

    const binary = evidence.files.find((file) => file.path === 'assets/logo.png');
    expect(binary).toMatchObject({
      status: 'added',
      binary: true,
      lineCountsAvailable: true,
      insertions: 0,
      deletions: 0,
      changes: 0,
      extension: '.png',
      category: 'unknown',
    });
    // The text file still joins, and the binary record is NOT a join miss.
    expect(evidence.files.find((file) => file.path === 'src/keep.ts')).toMatchObject({
      status: 'modified',
      binary: false,
      lineCountsAvailable: true,
      insertions: 1,
      deletions: 0,
    });
    expect(evidence.totals).toMatchObject({
      lineCountsAvailable: true,
      filesMissingLineCounts: 0,
      unmatchedStatisticsFiles: 0,
      binaryFiles: 1,
      files: 2,
      insertions: 1,
      deletions: 0,
    });
    expect(evidence.degradations).toEqual([]);
  }, GIT_TEST_TIMEOUT);

  it('reports real line counts for an unborn repository', async () => {
    const root = makeGitRoot();
    const git = await initRepo(root);
    writeRepoFile(root, 'first.ts', lines(1));
    await git.add(['.']);

    const evidence = await new ChangeEvidenceBuilder().build(root);

    expect(evidence.repository.worktreeState).toBe('unborn');
    expect(evidence.repository.headRevision).toBeUndefined();
    expect(evidence.files[0]).toMatchObject({ path: 'first.ts', status: 'added', insertions: 1, deletions: 0 });
    expect(evidence.totals.lineCountsAvailable).toBe(true);
  }, GIT_TEST_TIMEOUT);

  it('emits verbatim repository paths for non-ASCII and spaced names under default core.quotePath (P1)', async () => {
    const root = makeGitRoot();
    const git = await initRepo(root);
    // core.quotePath=true is the Git default; set it explicitly so the test is
    // deterministic on machines where a global config changed it.
    await git.addConfig('core.quotePath', 'true');

    const base = lines(3, 'base');
    writeRepoFile(root, 'docs/na\u00efve file.md', base);
    await git.add(['.']);
    await git.commit('base');

    // Staged change: a non-ASCII source file and a modified doc with a space.
    writeRepoFile(root, 'src/caf\u00e9.ts', lines(4, 'src'));
    writeRepoFile(root, 'docs/na\u00efve file.md', base.replace('base 2', 'EDITED'));
    await git.add(['.']);

    // Sanity: with core.quotePath=true, the quoting form is what git prints
    // without -z. The builder must never surface that escaped form.
    const quoted = await git.diff(['--cached', '--name-status', '-M', '-C']);
    expect(quoted).toContain('"src/caf\\303\\251.ts"');

    const evidence = await new ChangeEvidenceBuilder().build(root);

    expect(evidence.files.map((file) => file.path)).toEqual([
      'docs/na\u00efve file.md',
      'src/caf\u00e9.ts',
    ]);
    const [doc, src] = evidence.files;
    expect(src).toMatchObject({
      path: 'src/caf\u00e9.ts',
      status: 'added',
      lineCountsAvailable: true,
      insertions: 4,
      deletions: 0,
      extension: '.ts',
      category: 'source',
      subsystem: 'src',
      conflicted: false,
    });
    expect(doc).toMatchObject({
      path: 'docs/na\u00efve file.md',
      status: 'modified',
      lineCountsAvailable: true,
      insertions: 1,
      deletions: 1,
      extension: '.md',
      category: 'documentation',
      subsystem: 'docs/na\u00efve file.md',
    });
    expect(evidence.identitySource).toBe('staged-diff');
    expect(evidence.degradations).toEqual([]);
    expect(evidence.totals).toMatchObject({
      lineCountsAvailable: true,
      filesMissingLineCounts: 0,
      unmatchedStatisticsFiles: 0,
      files: 2,
      insertions: 5,
      deletions: 1,
    });
    // NOTE: paths containing quotes or backslashes cannot be materialized on
    // Windows (reserved filename characters), so they are covered at the
    // parser boundary above, not by a real-Git fixture here.
  }, GIT_TEST_TIMEOUT);

  it('recognizes a matching conflicted path as conflicted in real Git (P1 identity matching)', async () => {
    const root = makeGitRoot();
    const git = await initRepo(root);
    await git.addConfig('core.quotePath', 'true');

    const base = lines(3, 'base');
    writeRepoFile(root, 'conf/caf\u00e9-conflict.txt', base);
    await git.add(['.']);
    await git.commit('base');

    const initialBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    // Divergent branches that collide on the same non-ASCII path.
    await git.checkoutBranch('other', 'HEAD');
    writeRepoFile(root, 'conf/caf\u00e9-conflict.txt', base.replace('base 1', 'OTHER'));
    await git.add(['.']);
    await git.commit('other');
    await git.checkout(initialBranch);
    writeRepoFile(root, 'conf/caf\u00e9-conflict.txt', base.replace('base 1', 'MAIN'));
    await git.add(['.']);
    await git.commit('main');
    await git.raw(['merge', 'other']).catch(() => undefined); // leaves the index unmerged

    // A clean staged file alongside the unmerged index entry.
    writeRepoFile(root, 'src/post-merge.ts', lines(3, 'staged'));
    await git.add(['src/post-merge.ts']);

    const status = await git.status();
    expect(status.conflicted).toEqual(['conf/caf\u00e9-conflict.txt']);

    const evidence = await new ChangeEvidenceBuilder().build(root);

    const conflicted = evidence.files.find((file) => file.path === 'conf/caf\u00e9-conflict.txt');
    expect(conflicted).toBeDefined();
    expect(conflicted).toMatchObject({
      status: 'unmerged',
      conflicted: true,
      lineCountsAvailable: true,
    });
    const staged = evidence.files.find((file) => file.path === 'src/post-merge.ts');
    expect(staged).toMatchObject({ status: 'added', conflicted: false, insertions: 3 });
    expect(evidence.identitySource).toBe('staged-diff');
    expect(evidence.degradations).toEqual([]);
  }, GIT_TEST_TIMEOUT);

  // Dogfood fixture: structurally mirrors the M5.2.4 change shape
  // (10 files / 643 insertions / 12 deletions across core repository source,
  // storage persistence, a schema migration, and tests) without asserting any
  // semantic intent such as "adds persistent file metadata indexing".
  it('captures the M5.2.4-shaped 10-file/643/12 dogfood change structurally', async () => {
    const root = makeGitRoot();
    const git = await initRepo(root);

    // Baseline: the two files that will be modified.
    writeRepoFile(root, 'src/core/repository/repository.file-index.ts', lines(12, 'old index'));
    writeRepoFile(root, 'test/core/repository/repository.file-index.test.ts', lines(10, 'test'));
    await git.add(['.']);
    await git.commit('baseline');

    // Staged change: 5 source, 1 persistence, 1 migration, 3 test files.
    const staged: Array<[string, string]> = [
      ['src/core/repository/repository.file-index.ts', lines(23, 'index')],           // +23/-12
      ['test/core/repository/repository.file-index.test.ts', lines(10, 'test') + lines(18, 'added-test')], // +18/-0
      ['src/core/storage/migrations/0002_repository_files.sql', lines(40, 'sql')],    // +40
      ['src/core/repository/change-evidence.ts', lines(80, 'src')],                   // +80
      ['src/core/repository/change-evidence.rules.ts', lines(60, 'rules')],           // +60
      ['src/core/storage/sqlite.repository-file-index.ts', lines(95, 'store')],       // +95
      ['src/core/repository/repository.indexer.ts', lines(100, 'indexer')],           // +100
      ['src/core/repository/repository.retriever.ts', lines(92, 'retriever')],        // +92
      ['test/core/repository/change-evidence.test.ts', lines(70, 'spec')],            // +70
      ['test/core/repository/change-evidence.rules.test.ts', lines(65, 'spec')],      // +65
    ];
    for (const [relativePath, content] of staged) writeRepoFile(root, relativePath, content);
    await git.add(['.']);

    const evidence = await new ChangeEvidenceBuilder().build(root);

    // Structural facts the future AI context must never be starved of.
    expect(evidence.totals.files).toBe(10);
    expect(evidence.totals.insertions).toBe(643);
    expect(evidence.totals.deletions).toBe(12);
    expect(evidence.totals.lineCountsAvailable).toBe(true);

    const byCategory = new Map<string, number>();
    for (const file of evidence.files) {
      byCategory.set(file.category, (byCategory.get(file.category) ?? 0) + 1);
    }
    expect(byCategory.get('source')).toBe(5);
    expect(byCategory.get('persistence')).toBe(1);
    expect(byCategory.get('migration')).toBe(1);
    expect(byCategory.get('test')).toBe(3);

    const subsystems = [...new Set(evidence.files.map((file) => file.subsystem))].sort();
    expect(subsystems).toEqual(['src/core/repository', 'src/core/storage', 'test/core']);

    const byPath = new Map(evidence.files.map((file) => [file.path, file]));
    expect(byPath.get('src/core/repository/repository.file-index.ts')).toMatchObject({
      status: 'modified', insertions: 23, deletions: 12, category: 'source',
    });
    expect(byPath.get('src/core/storage/sqlite.repository-file-index.ts')).toMatchObject({
      status: 'added', insertions: 95, category: 'persistence',
    });
    expect(byPath.get('src/core/storage/migrations/0002_repository_files.sql')).toMatchObject({
      status: 'added', insertions: 40, category: 'migration',
    });

    expect(evidence.signals.sourceCodeChanges).toBe(true);
    expect(evidence.signals.persistenceOrStorageChanges).toBe(true);
    expect(evidence.signals.schemaOrMigrationChanges).toBe(true);
    expect(evidence.signals.testChanges).toBe(true);
    expect(evidence.signals.testOnlyChange).toBe(false);
    expect(evidence.signals.unstagedChangesPresent).toBe(false);

    expect(evidence.tier).toBe('high');
    expect(evidence.tierReasons).toContain('persistence/storage files changed');
    expect(evidence.tierReasons).toContain('schema/migration files changed');

    // Aggregation consistency: totals equal the joined per-file statistics.
    expect(evidence.totals.insertions).toBe(evidence.files.reduce((sum, f) => sum + f.insertions, 0));
    expect(evidence.totals.deletions).toBe(evidence.files.reduce((sum, f) => sum + f.deletions, 0));

    // Structural-only packet: no semantic prose fields, fixed schema.
    expect(Object.keys(evidence).sort()).toEqual([
      'degradations', 'files', 'identitySource', 'repository', 'schemaVersion', 'signals', 'tier', 'tierReasons', 'totals',
    ]);
  }, GIT_TEST_TIMEOUT);
});
