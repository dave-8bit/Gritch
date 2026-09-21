import { describe, expect, it } from 'vitest';

import {
  ChangeContextComposer,
  DEFAULT_CHANGE_CONTEXT_BUDGETS,
  collectRepositoryFacts,
  discoverRelatedFiles,
  selectContents,
  selectDiffSections,
  splitDiffSections,
  type ChangeContextBudgets,
} from '../../../src/core/repository/change-context';
import type {
  ChangeEvidence,
  ChangeFileRecord,
  ChangeFileStatus,
} from '../../../src/core/repository/change-evidence';
import {
  classifyChangeFile,
  classifyRisk,
  deriveChangeSignals,
  deriveSubsystem,
} from '../../../src/core/repository/change-evidence.rules';
import { repositoryPathExtension, normalizeRepositoryPath } from '../../../src/core/repository/repository.file-index';
import type { RepositoryFileIndexReader, RepositoryFileRecord } from '../../../src/core/repository/repository.file-index';
import { RepositoryRetriever } from '../../../src/core/repository/repository.retriever';
import type { RepositoryStatus } from '../../../src/core/repository/repository.state';
import type {
  RepositoryContentReader,
  RepositoryFileContent,
} from '../../../src/core/repository/repository-content';
import type { RepositoryProfile } from '../../../src/inspect/profile';
import { makeRepositoryProfile } from '../../helpers/repository-profile';
import { reviewUserPrompt } from '../../../src/ai/prompts';

const REPOSITORY_ROOT = '/repo';

interface FileSpec {
  path: string;
  status: ChangeFileStatus;
  insertions: number;
  deletions: number;
  previousPath?: string;
  lineCountsAvailable?: boolean;
  binary?: boolean;
}

/** The M5.2.4-shaped 10-file change, plus a documentation file and a deletion. */
const FILE_SPECS: FileSpec[] = [
  { path: 'src/core/repository/change-evidence.rules.ts', status: 'added', insertions: 60, deletions: 0 },
  { path: 'src/core/repository/change-evidence.ts', status: 'added', insertions: 80, deletions: 0 },
  { path: 'src/core/repository/repository.file-index.ts', status: 'modified', insertions: 23, deletions: 12 },
  { path: 'src/core/repository/repository.indexer.ts', status: 'added', insertions: 100, deletions: 0 },
  { path: 'src/core/repository/repository.retriever.ts', status: 'added', insertions: 92, deletions: 0 },
  { path: 'src/core/storage/migrations/0002_repository_files.sql', status: 'added', insertions: 40, deletions: 0 },
  { path: 'src/core/storage/sqlite.repository-file-index.ts', status: 'added', insertions: 95, deletions: 0 },
  { path: 'test/core/repository/change-evidence.rules.test.ts', status: 'added', insertions: 65, deletions: 0 },
  { path: 'test/core/repository/change-evidence.test.ts', status: 'added', insertions: 70, deletions: 0 },
  { path: 'test/core/repository/repository.file-index.test.ts', status: 'modified', insertions: 18, deletions: 0 },
];

function makeRecord(spec: FileSpec): ChangeFileRecord {
  const path = normalizeRepositoryPath(spec.path);
  const record: ChangeFileRecord = {
    path,
    status: spec.status,
    lineCountsAvailable: spec.lineCountsAvailable ?? true,
    insertions: spec.insertions,
    deletions: spec.deletions,
    changes: spec.insertions + spec.deletions,
    binary: spec.binary ?? false,
    extension: repositoryPathExtension(path),
    category: classifyChangeFile(path),
    subsystem: deriveSubsystem(path),
    conflicted: false,
  };
  if (spec.previousPath) record.previousPath = normalizeRepositoryPath(spec.previousPath);
  return record;
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

/** Evidence built with the real deterministic classification rules. */
function makeEvidence(specs: FileSpec[] = FILE_SPECS): ChangeEvidence {
  const files = specs.map(makeRecord).sort((left, right) => left.path.localeCompare(right.path));
  const status = makeStatus();
  const signals = deriveChangeSignals(files, status);
  const { tier, tierReasons } = classifyRisk(files, signals);

  return {
    schemaVersion: 1,
    repository: {
      root: REPOSITORY_ROOT,
      key: REPOSITORY_ROOT,
      headRevision: 'abc123',
      worktreeState: 'dirty',
    },
    identitySource: 'staged-diff',
    degradations: [],
    files,
    totals: {
      lineCountsAvailable: files.every((file) => file.lineCountsAvailable),
      filesMissingLineCounts: files.filter((file) => !file.lineCountsAvailable).length,
      unmatchedStatisticsFiles: 0,
      files: files.length,
      insertions: files.reduce((sum, file) => sum + file.insertions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      binaryFiles: files.filter((file) => file.binary).length,
      byStatus: files.reduce((acc, file) => {
        acc[file.status] = (acc[file.status] ?? 0) + 1;
        return acc;
      }, {} as ChangeEvidence['totals']['byStatus']),
    },
    signals,
    tier,
    tierReasons,
  };
}

/** A raw diff with one section per file, two whole hunks per section. */
function makeStagedDiff(files: readonly ChangeFileRecord[]): string {
  return files
    .map((file, index) => [
      `diff --git a/${file.path} b/${file.path}`,
      `index 0000000..${index}abcdef 100644`,
      `--- a/${file.path}`,
      `+++ b/${file.path}`,
      `@@ -1,2 +1,3 @@`,
      ' context line',
      `+added line for ${file.path}`,
      ' trailing context',
      `@@ -10,2 +11,2 @@`,
      ' more context',
      `-removed line ${index}`,
    ].join('\n'))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Fakes: content reader, metadata index, repository profile
// ---------------------------------------------------------------------------

interface FakeReader {
  reader: RepositoryContentReader;
  requested: string[];
}

function makeContentReader(
  contents: Record<string, string>,
  perFileCharLimit = Number.POSITIVE_INFINITY,
): FakeReader {
  const requested: string[] = [];

  const readText = (repositoryPath: string, relativePath: string): RepositoryFileContent | undefined => {
    requested.push(relativePath);
    const normalized = normalizeRepositoryPath(relativePath);
    const content = contents[normalized];
    if (content === undefined) return undefined;
    const truncated = content.length > perFileCharLimit;
    return {
      relativePath: normalized,
      content: truncated ? content.slice(0, perFileCharLimit) : content,
      sizeBytes: content.length,
      truncated,
    };
  };

  return {
    requested,
    reader: {
      readText,
      readMany: (repositoryPath, relativePaths) =>
        relativePaths
          .map((relativePath) => readText(repositoryPath, relativePath))
          .filter((value): value is RepositoryFileContent => value !== undefined),
    },
  };
}

function makeIndexReader(paths: readonly string[], fail = false): RepositoryFileIndexReader {
  const records = paths.map((relativePath): RepositoryFileRecord => ({
    repositoryKey: REPOSITORY_ROOT,
    relativePath,
    sizeBytes: 100,
    modifiedTime: 0,
    extension: repositoryPathExtension(relativePath),
    metadataVersion: 1,
  }));

  const guard = (): void => {
    if (fail) throw new Error('repository file index unavailable');
  };

  return {
    findByPath: (_identity, relativePath) => {
      guard();
      return records.find((record) => record.relativePath === relativePath);
    },
    findByPrefix: (_identity, prefix) => {
      guard();
      return records.filter(
        (record) => record.relativePath === prefix || record.relativePath.startsWith(`${prefix}/`),
      );
    },
    findByExtension: (_identity, extension) => {
      guard();
      return records.filter((record) => record.extension === extension);
    },
    searchPaths: (_identity, query) => {
      guard();
      return records.filter((record) => record.relativePath.includes(query));
    },
  };
}

function makeRetriever(paths: readonly string[], fail = false): RepositoryRetriever {
  return new RepositoryRetriever({
    reader: makeIndexReader(paths, fail),
    resolveIdentity: () => ({ root: REPOSITORY_ROOT, key: REPOSITORY_ROOT }),
  });
}

function makeComposer(options: {
  evidence?: ChangeEvidence;
  diff?: string;
  diffError?: Error;
  contents?: Record<string, string>;
  perFileCharLimit?: number;
  retriever?: RepositoryRetriever;
  profile?: RepositoryProfile;
  profileError?: Error;
  budgets?: Partial<ChangeContextBudgets>;
} = {}) {
  const evidence = options.evidence ?? makeEvidence();
  // Mirrors production wiring: the filesystem reader receives its per-file
  // limit from the composed budget configuration.
  const fakeReader = makeContentReader(
    options.contents ?? {},
    options.perFileCharLimit ?? options.budgets?.perFileContentChars,
  );

  const composer = new ChangeContextComposer({
    buildEvidence: () => Promise.resolve(evidence),
    readStagedDiff: () => (options.diffError
      ? Promise.reject(options.diffError)
      : Promise.resolve(options.diff ?? makeStagedDiff(evidence.files))),
    contentReader: fakeReader.reader,
    inspect: () => {
      if (options.profileError) throw options.profileError;
      return options.profile ?? makeRepositoryProfile();
    },
    ...(options.retriever ? { retriever: options.retriever } : {}),
    ...(options.budgets || options.perFileCharLimit !== undefined
      ? { budgets: { ...(options.budgets ?? {}), ...(options.perFileCharLimit !== undefined ? { perFileContentChars: options.perFileCharLimit } : {}) } }
      : {}),
  });

  return { composer, evidence, fakeReader };
}

const TINY_BUDGETS: Partial<ChangeContextBudgets> = {
  diffChars: 0,
  fileContentChars: 0,
  perFileContentChars: 0,
  repositoryContextChars: 0,
  totalContextChars: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChangeContextComposer — mandatory deterministic material', () => {
  it('carries deterministic evidence through rendering into the review prompt', async () => {
    const { composer, evidence } = makeComposer({
      contents: {
        'src/core/repository/change-evidence.ts': 'export const evidence = true;\n',
      },
    });

    const context = await composer.build(REPOSITORY_ROOT);
    const prompt = reviewUserPrompt(context);

    expect(prompt).toContain('Change overview (deterministic evidence)');
    expect(prompt).toContain('Changed files (complete mandatory metadata)');
    for (const file of evidence.files) {
      expect(prompt).toContain(file.path);
      expect(prompt).toContain(`status: ${file.status}`);
      expect(prompt).toContain(`category: ${file.category}`);
      expect(prompt).toContain(`subsystem: ${file.subsystem}`);
    }
    expect(prompt).toContain('insertions 80');
    expect(prompt).toContain('deletions 0');
    expect(prompt).toContain('Staged diff (index vs HEAD)');
    expect(prompt).toContain('Repository facts relevant to this change');
    expect(prompt).toContain('Evidence limitations');
    expect(prompt).toContain('The complete staged diff was supplied');
    expect(prompt).toContain('"signals"');
    expect(prompt).toContain('export const evidence = true;');
  });

  it('represents every changed file with its metadata', async () => {
    const { composer, evidence } = makeComposer();

    const context = await composer.build(REPOSITORY_ROOT);

    expect(context.files).toHaveLength(evidence.files.length);
    expect(context.files.map((file) => file.record.path)).toEqual(evidence.files.map((file) => file.path));

    const byPath = new Map(context.files.map((file) => [file.record.path, file.record]));
    expect(byPath.get('src/core/repository/repository.file-index.ts')).toEqual(
      evidence.files.find((file) => file.path === 'src/core/repository/repository.file-index.ts'),
    );
    expect(byPath.get('src/core/storage/migrations/0002_repository_files.sql')).toMatchObject({
      status: 'added',
      insertions: 40,
      category: 'migration',
      subsystem: 'src/core/storage',
    });
    expect(byPath.get('test/core/repository/change-evidence.test.ts')).toMatchObject({
      category: 'test',
      subsystem: 'test/core',
    });
  });

  it('carries the complete deterministic overview', async () => {
    const { composer, evidence } = makeComposer();

    const context = await composer.build(REPOSITORY_ROOT);

    expect(context.overview.evidence.repository).toEqual(evidence.repository);
    expect(context.overview.evidence.identitySource).toBe('staged-diff');
    expect(context.overview.evidence.degradations).toEqual([]);
    expect(context.overview.evidence.tier).toBe(evidence.tier);
    expect(context.overview.evidence.tierReasons).toEqual(evidence.tierReasons);
    expect(context.overview.evidence.totals).toEqual(evidence.totals);
    expect(context.overview.evidence.signals).toEqual(evidence.signals);
    expect(context.overview.fileCount).toBe(evidence.files.length);
    expect(context.overview.notes.join('\n')).toContain('Change risk tier: high');
  });

  it('keeps every changed file when every optional budget is zero', async () => {
    const { composer, evidence } = makeComposer({ budgets: TINY_BUDGETS });

    const context = await composer.build(REPOSITORY_ROOT);

    expect(context.files).toHaveLength(10);
    for (const file of context.files) {
      const original = evidence.files.find((candidate) => candidate.path === file.record.path);
      expect(file.record).toEqual(original);
    }
    expect(context.overview.evidence.totals.files).toBe(10);
    expect(context.truncation.diffTruncated).toBe(true);
    expect(context.truncation.notes.length).toBeGreaterThan(0);
  });

  it('states degradations instead of implying missing information is absent', async () => {
    const evidence = makeEvidence([
      { path: 'src/core/a.ts', status: 'modified', insertions: 0, deletions: 0, lineCountsAvailable: false },
    ]);
    evidence.degradations = ['identity-from-repository-status', 'line-statistics-incomplete'];
    evidence.identitySource = 'repository-status';
    evidence.totals.lineCountsAvailable = false;
    evidence.totals.filesMissingLineCounts = 1;
    evidence.totals.unmatchedStatisticsFiles = 2;
    const { composer } = makeComposer({ evidence });

    const context = await composer.build(REPOSITORY_ROOT);
    const notes = context.overview.notes.join('\n');

    expect(notes).toContain('identity source: repository-status');
    expect(notes).toContain('identity came from repository status entries');
    expect(notes).toContain('do not cover the complete staged change set');
    expect(notes).toContain('unavailable, not zero');
    expect(notes).toContain('matched no changed file');
  });

  it('notes that only staged changes were reviewed when the worktree is dirty', async () => {
    const { composer } = makeComposer();

    const context = await composer.build(REPOSITORY_ROOT);

    expect(context.overview.notes.join('\n')).toContain('unstaged and untracked changes were not reviewed');
  });
});


describe('ChangeContextComposer — staged diff selection', () => {
  it('supplies every section when the budget allows', async () => {
    const { composer, evidence } = makeComposer();

    const context = await composer.build(REPOSITORY_ROOT);

    expect(context.diffSections.status).toBe('available');
    expect(context.diffSections.complete).toBe(true);
    expect(context.diffSections.omittedSections).toEqual([]);
    expect(context.diffSections.sections.map((section) => section.path)).toEqual(
      evidence.files.map((file) => file.path),
    );
    expect(context.diffSections.sections.every((section) => section.complete)).toBe(true);
    expect(context.truncation.diffTruncated).toBe(false);
  });

  it('covers many changed files instead of splitting one section in half', async () => {
    const { composer, evidence } = makeComposer({ budgets: { diffChars: 1400 } });

    const context = await composer.build(REPOSITORY_ROOT);
    const omitted = context.diffSections.omittedSections.length;

    expect(context.diffSections.complete).toBe(false);
    expect(omitted).toBeGreaterThan(0);
    expect(context.diffSections.sections.length + omitted).toBe(evidence.files.length);
    expect(context.diffSections.notes.join('\n')).toContain('did not see the complete diff');

    // Whole-file coverage beats depth: even a small budget still supplies
    // several distinct files rather than one file's two hunks and nothing else.
    expect(context.diffSections.sections.length).toBeGreaterThan(1);
    for (const section of context.diffSections.sections) {
      expect(section.includedHunks).toBeLessThanOrEqual(section.totalHunks);
    }
  });

  it('never splits a hunk', async () => {
    const { composer, evidence } = makeComposer({ budgets: { diffChars: 900 } });

    const context = await composer.build(REPOSITORY_ROOT);

    for (const section of context.diffSections.sections) {
      const hunkCount = (section.hunks.match(/^@@/gm) ?? []).length;
      expect(hunkCount).toBe(section.includedHunks);
      for (const hunk of section.hunks.split(/(?=^@@)/m)) {
        const body = hunk.trimEnd();
        if (body === '') continue;
        // A whole hunk always ends with its last content line, never mid-line:
        // either the fixture's trailing context line or its removed line.
        expect(body.endsWith(' trailing context') || /-removed line \d+$/.test(body)).toBe(true);
      }
    }
    expect(evidence.files.length).toBeGreaterThan(0);
  });

  it('reports an unreadable staged diff as an explicit limitation', async () => {
    const { composer } = makeComposer({ diffError: new Error('No staged changes found.') });

    const context = await composer.build(REPOSITORY_ROOT);

    expect(context.diffSections.status).toBe('unavailable');
    expect(context.diffSections.unavailableReason).toBe('No staged changes found.');
    expect(context.diffSections.sections).toEqual([]);
    expect(context.diffSections.notes.join('\n')).toContain('must not assume diff content');
    expect(context.truncation.diffTruncated).toBe(true);
    expect(context.files).toHaveLength(10);
  });

  it('sections are deterministic across repeated builds', async () => {
    const { composer } = makeComposer({ budgets: { diffChars: 1400 } });

    const first = await composer.build(REPOSITORY_ROOT);
    const second = await composer.build(REPOSITORY_ROOT);

    expect(first.diffSections).toEqual(second.diffSections);
  });

  it('orders sections by the deterministic changed-file order', () => {
    const evidence = makeEvidence();
    const parsed = splitDiffSections(makeStagedDiff([...evidence.files].reverse()), evidence.files);

    const selected = selectDiffSections(parsed, evidence.files, 12000);

    expect(selected.sections.map((section) => section.path)).toEqual(
      evidence.files.map((file) => file.path),
    );
  });
});


describe('ChangeContextComposer — content selection', () => {
  const contents = {
    'src/core/repository/change-evidence.ts': 'export const evidence = true;\n',
    'src/core/repository/change-evidence.rules.ts': 'export const rules = true;\n',
    'src/core/repository/repository.file-index.ts': 'export const index = true;\n',
    'src/core/repository/repository.indexer.ts': 'export const indexer = true;\n',
    'src/core/repository/repository.retriever.ts': 'export const retriever = true;\n',
    'src/core/storage/migrations/0002_repository_files.sql': 'CREATE TABLE repository_files (id TEXT);\n',
    'test/core/repository/change-evidence.rules.test.ts': 'describe("rules", () => {});\n',
    'test/core/repository/change-evidence.test.ts': 'describe("evidence", () => {});\n',
    'test/core/repository/repository.file-index.test.ts': 'describe("index", () => {});\n',
  };

  it('supplies content for changed files and marks unreadable ones', async () => {
    const { composer } = makeComposer({ contents });

    const context = await composer.build(REPOSITORY_ROOT);

    const supplied = context.contents.filter((entry) => entry.status === 'supplied');
    expect(supplied.length).toBeGreaterThan(0);
    expect(supplied.every((entry) => entry.role === 'changed-file')).toBe(true);
    expect(supplied[0].content).toContain('export const');

    const sqlite = context.contents.find((entry) => entry.path === 'src/core/storage/sqlite.repository-file-index.ts');
    expect(sqlite?.status).toBe('not-supplied');
    expect(sqlite?.content).toBeUndefined();
  });

  it('prioritizes implementation content over documentation under a tight budget', async () => {
    const evidence = makeEvidence([
      { path: 'README.md', status: 'modified', insertions: 30, deletions: 0 },
      { path: 'src/core/a.ts', status: 'modified', insertions: 30, deletions: 0 },
    ]);
    const body = 'x'.repeat(400);
    const { composer } = makeComposer({
      evidence,
      contents: { 'README.md': body, 'src/core/a.ts': body },
      budgets: { fileContentChars: 700, perFileContentChars: 400 },
    });

    const context = await composer.build(REPOSITORY_ROOT);

    const byPath = new Map(context.contents.map((entry) => [entry.path, entry]));
    expect(byPath.get('src/core/a.ts')?.status).toBe('supplied');
    expect(byPath.get('README.md')?.status).toBe('budget-exhausted');
  });

  it('marks deleted files as deleted instead of unread', async () => {
    const evidence = makeEvidence([
      { path: 'src/core/removed.ts', status: 'deleted', insertions: 0, deletions: 12 },
    ]);
    const { composer, fakeReader } = makeComposer({ evidence, contents: {} });

    const context = await composer.build(REPOSITORY_ROOT);

    expect(context.files[0].contentStatus).toBe('file-deleted');
    expect(context.contents[0]).toMatchObject({ path: 'src/core/removed.ts', status: 'file-deleted' });
    expect(fakeReader.requested).toEqual([]);
  });

  it('marks binary files as binary', async () => {
    const evidence = makeEvidence([
      { path: 'assets/logo.png', status: 'added', insertions: 0, deletions: 0, binary: true },
    ]);
    const { composer } = makeComposer({ evidence, contents: {} });

    const context = await composer.build(REPOSITORY_ROOT);

    expect(context.files[0].contentStatus).toBe('binary');
    expect(context.contents[0].status).toBe('binary');
  });

  it('records per-file truncation from the reader', async () => {
    const evidence = makeEvidence([
      { path: 'src/core/long.ts', status: 'modified', insertions: 5, deletions: 0 },
    ]);
    const { composer } = makeComposer({
      evidence,
      contents: { 'src/core/long.ts': 'y'.repeat(500) },
      budgets: { perFileContentChars: 100 },
    });

    const context = await composer.build(REPOSITORY_ROOT);

    expect(context.contents[0]).toMatchObject({ status: 'supplied', truncated: true });
    expect(context.contents[0].content).toHaveLength(100);
    expect(context.truncation.contentTruncated).toBe(true);
  });

  it('only ever asks the reader for repository-relative changed paths', async () => {
    const { composer, evidence, fakeReader } = makeComposer({ contents });

    await composer.build(REPOSITORY_ROOT);

    const changedPaths = new Set(evidence.files.map((file) => file.path));
    expect(fakeReader.requested.length).toBeGreaterThan(0);
    for (const requested of fakeReader.requested) {
      expect(changedPaths.has(requested)).toBe(true);
      expect(requested.startsWith('/')).toBe(false);
      expect(requested.includes('..')).toBe(false);
    }
  });

  it('is deterministic across repeated content selection', async () => {
    const { composer } = makeComposer({ contents, budgets: { fileContentChars: 2000 } });

    const first = await composer.build(REPOSITORY_ROOT);
    const second = await composer.build(REPOSITORY_ROOT);

    expect(first.contents).toEqual(second.contents);
  });
});


describe('selectContents — related-file content ordering and accounting', () => {
  it('supplies related content after changed-file content', () => {
    const evidence = makeEvidence([
      { path: 'src/core/a.ts', status: 'modified', insertions: 5, deletions: 0 },
    ]);
    const fakeReader = makeContentReader({
      'src/core/a.ts': 'changed\n',
      'test/core/a.test.ts': 'related\n',
    });

    const selected = selectContents({
      repositoryRoot: REPOSITORY_ROOT,
      files: evidence.files,
      related: [{
        path: 'test/core/a.test.ts',
        relation: 'corresponding-test',
        relatedTo: 'src/core/a.ts',
        knownToIndex: true,
      }],
      reader: fakeReader.reader,
      budgetChars: 2000,
    });

    expect(selected.contents.map((entry) => [entry.path, entry.role])).toEqual([
      ['src/core/a.ts', 'changed-file'],
      ['test/core/a.test.ts', 'related-file'],
    ]);
    expect(selected.contents[1].relation).toBe('corresponding-test');
    expect(selected.relatedSupplied).toBe(1);
  });

  it('distinguishes related candidates from supplied related content', () => {
    const evidence = makeEvidence([
      { path: 'src/core/a.ts', status: 'modified', insertions: 5, deletions: 0 },
    ]);
    const fakeReader = makeContentReader({ 'src/core/a.ts': 'changed\n' });

    const selected = selectContents({
      repositoryRoot: REPOSITORY_ROOT,
      files: evidence.files,
      related: [
        { path: 'test/core/a.test.ts', relation: 'corresponding-test', knownToIndex: true },
        { path: 'src/core/b.ts', relation: 'same-directory', knownToIndex: true },
      ],
      reader: fakeReader.reader,
      budgetChars: 1000,
    });

    expect(selected.relatedCandidates).toBe(2);
    expect(selected.relatedAttempted).toBe(2);
    expect(selected.relatedSupplied).toBe(0);
    expect(selected.contents.filter((entry) => entry.role === 'related-file').every(
      (entry) => entry.status === 'not-supplied',
    )).toBe(true);
  });

  it('does not report a deleted file as truncated evidence', () => {
    const evidence = makeEvidence([
      { path: 'src/core/removed.ts', status: 'deleted', insertions: 0, deletions: 4 },
      { path: 'src/core/kept.ts', status: 'modified', insertions: 4, deletions: 0 },
    ]);
    const fakeReader = makeContentReader({ 'src/core/kept.ts': 'kept\n' });

    const selected = selectContents({
      repositoryRoot: REPOSITORY_ROOT,
      files: evidence.files,
      related: [],
      reader: fakeReader.reader,
      budgetChars: 2000,
    });

    expect(selected.changedTruncated).toBe(false);
    expect(selected.statusByPath.get('src/core/removed.ts')).toBe('file-deleted');
    expect(selected.statusByPath.get('src/core/kept.ts')).toBe('supplied');
  });
});


describe('ChangeContextComposer — related-file lookup', () => {
  const indexPaths = [
    'src/core/repository/change-evidence.ts',
    'src/core/repository/repository.state.ts',
    'test/core/repository/change-evidence.test.ts',
    'package.json',
    'tsconfig.json',
    'src/index.ts',
  ];

  it('states that lookup was not performed when no index is available', async () => {
    const { composer } = makeComposer({ contents: {} });

    const context = await composer.build(REPOSITORY_ROOT);
    const notes = context.overview.notes.join('\n');

    expect(context.overview.relatedFileLookup).toBe('not-performed');
    expect(context.relatedFiles).toEqual([]);
    expect(notes).toContain('Related-file lookup was not performed');
    expect(notes).not.toContain('found no related files');
    expect(context.files.every((file) => file.relatedFileLookup === 'not-performed')).toBe(true);
  });

  it('distinguishes an empty lookup result from an unavailable lookup', async () => {
    const { composer } = makeComposer({ contents: {}, retriever: makeRetriever([]) });

    const context = await composer.build(REPOSITORY_ROOT);

    expect(context.overview.relatedFileLookup).toBe('performed');
    expect(context.relatedFiles).toEqual([]);
    expect(context.overview.notes.join('\n')).toContain('found no related files');
  });

  it('reports an unreadable index as an unavailable lookup, not as absence', async () => {
    const { composer } = makeComposer({ contents: {}, retriever: makeRetriever(indexPaths, true) });

    const context = await composer.build(REPOSITORY_ROOT);

    expect(context.overview.relatedFileLookup).toBe('unavailable');
    expect(context.relatedFiles).toEqual([]);
    const notes = context.overview.notes.join('\n');
    expect(notes).toContain('Related-file lookup was not performed');
    expect(notes).toContain('could not be read');
  });

  it('finds corresponding tests and same-directory files deterministically', async () => {
    // Single-file change so the corresponding test file is not itself changed
    // (changed files are never listed as their own related files).
    const evidence = makeEvidence([
      { path: 'src/core/repository/change-evidence.ts', status: 'added', insertions: 80, deletions: 0 },
    ]);
    const { composer } = makeComposer({ evidence, contents: {}, retriever: makeRetriever(indexPaths) });

    const context = await composer.build(REPOSITORY_ROOT);
    const repeated = await composer.build(REPOSITORY_ROOT);

    expect(context.relatedFiles).toEqual(repeated.relatedFiles);
    expect(context.relatedFiles.find((related) => related.path === 'test/core/repository/change-evidence.test.ts'))
      .toMatchObject({
        relation: 'corresponding-test',
        relatedTo: 'src/core/repository/change-evidence.ts',
        knownToIndex: true,
      });
    expect(context.relatedFiles.find((related) => related.path === 'src/core/repository/repository.state.ts')?.relation)
      .toBe('same-directory');

    const changedFile = context.files.find(
      (file) => file.record.path === 'src/core/repository/change-evidence.ts',
    );
    expect(changedFile?.relatedFiles.some(
      (related) => related.path === 'test/core/repository/change-evidence.test.ts',
    )).toBe(true);
  });

  it('consults repository-level candidates only when the change signals justify them', () => {
    const retriever = makeRetriever(indexPaths);

    const migrationChange = discoverRelatedFiles(
      makeEvidence([{ path: 'src/core/storage/migration.sql', status: 'added', insertions: 10, deletions: 0 }]),
      retriever,
    );
    const migrationRelations = new Set(migrationChange.files.map((file) => file.relation));
    expect(migrationRelations.has('package-metadata')).toBe(false);
    expect(migrationRelations.has('entrypoint')).toBe(false);

    const dependencyChange = discoverRelatedFiles(
      makeEvidence([
        { path: 'package.json', status: 'modified', insertions: 3, deletions: 1 },
        // A CLI-surface path that is not itself an entrypoint candidate.
        { path: 'src/commands/review.ts', status: 'modified', insertions: 1, deletions: 1 },
      ]),
      retriever,
    );
    const dependencyRelations = new Set(dependencyChange.files.map((file) => file.relation));
    expect(dependencyRelations.has('configuration')).toBe(true);
    expect(dependencyRelations.has('entrypoint')).toBe(true);
  });

  it('never claims a related file that the index does not contain', () => {
    const evidence = makeEvidence([
      { path: 'src/core/repository/change-evidence.ts', status: 'modified', insertions: 1, deletions: 1 },
    ]);

    const discovery = discoverRelatedFiles(evidence, makeRetriever(['src/core/repository/other.ts']));

    expect(discovery.files.some((file) => file.path.includes('change-evidence.test'))).toBe(false);
    expect(discovery.files.find((file) => file.path === 'src/core/repository/other.ts')?.relation)
      .toBe('same-directory');
  });
});


describe('ChangeContextComposer — repository facts', () => {
  it('includes facts for the signals present in the change', async () => {
    const { composer } = makeComposer({ contents: {} });

    const context = await composer.build(REPOSITORY_ROOT);
    const reasons = context.repositoryFacts.groups.map((group) => group.reason);
    const facts = context.repositoryFacts.groups.flatMap((group) => group.facts).join('\n');

    expect(reasons).toContain('test changes');
    expect(reasons).toContain('persistence/storage changes');
    expect(reasons).toContain('schema/migration changes');
    expect(reasons).not.toContain('configuration changes');
    expect(facts).toContain('testing: Vitest');
    expect(facts).toContain('database: SQLite');
    expect(facts).toContain('orm: Drizzle');
    expect(context.repositoryFacts.notes.join('\n')).toContain('filtered to the change signals');
  });

  it('includes dependency facts for dependency changes', async () => {
    const evidence = makeEvidence([
      { path: 'package.json', status: 'modified', insertions: 6, deletions: 2 },
    ]);
    const { composer } = makeComposer({ evidence, contents: {} });

    const context = await composer.build(REPOSITORY_ROOT);

    const facts = context.repositoryFacts.groups.flatMap((group) => group.facts).join('\n');
    expect(context.repositoryFacts.groups.map((group) => group.reason))
      .toContain('dependency/package metadata changes');
    expect(facts).toContain('package manager: npm');
    expect(facts).toContain('dependencies:');
  });

  it('falls back to a bounded baseline when no signal is present', async () => {
    const evidence = makeEvidence([
      { path: 'LICENSE', status: 'modified', insertions: 1, deletions: 1 },
    ]);
    const { composer } = makeComposer({ evidence, contents: {} });

    const context = await composer.build(REPOSITORY_ROOT);

    expect(context.repositoryFacts.groups.map((group) => group.reason)).toEqual(['repository baseline']);
  });

  it('stays inside the repository-context budget', () => {
    const profile = makeRepositoryProfile();
    const collected = collectRepositoryFacts({
      profile,
      signals: makeEvidence().signals,
      budgetChars: 60,
    });

    const total = collected.facts.groups.flatMap((group) => group.facts).join('\n').length;
    expect(total).toBeLessThanOrEqual(60);
    expect(collected.facts.notes.join('\n')).toContain('truncated');
  });

  it('states when the repository profile could not be inspected', async () => {
    const { composer } = makeComposer({ profileError: new Error('inspection failed') });

    const context = await composer.build(REPOSITORY_ROOT);

    expect(context.repositoryFacts.profileUnavailable).toBe(true);
    expect(context.repositoryFacts.groups).toEqual([]);
    expect(context.repositoryFacts.notes.join('\n')).toContain('could not be inspected');
    expect(context.files).toHaveLength(10);
  });
});

describe('ChangeContextComposer — explicit truncation reporting', () => {
  it('says no evidence was truncated when everything was supplied', async () => {
    const { composer } = makeComposer({
      contents: {
        'test/core/repository/change-evidence.test.ts': 'x\n',
        'src/core/repository/change-evidence.rules.ts': 'x\n',
        'src/core/repository/change-evidence.ts': 'x\n',
        'src/core/repository/repository.file-index.ts': 'x\n',
        'src/core/repository/repository.indexer.ts': 'x\n',
        'src/core/repository/repository.retriever.ts': 'x\n',
        'src/core/storage/migrations/0002_repository_files.sql': 'x\n',
        'src/core/storage/sqlite.repository-file-index.ts': 'x\n',
        'test/core/repository/change-evidence.rules.test.ts': 'x\n',
        'test/core/repository/repository.file-index.test.ts': 'x\n',
      },
      retriever: makeRetriever([]),
    });

    const context = await composer.build(REPOSITORY_ROOT);

    expect(context.truncation.diffTruncated).toBe(false);
    expect(context.truncation.contentTruncated).toBe(false);
    expect(context.truncation.relatedContentTruncated).toBe(false);
    expect(context.truncation.repositoryFactsTruncated).toBe(false);
    expect(context.truncation.notes.join('\n')).toContain('No evidence was truncated');
  });

  it('reports every limitation when budgets are exhausted', async () => {
    const { composer } = makeComposer({
      contents: { 'src/core/repository/change-evidence.ts': 'x'.repeat(400) },
      // A related file that is not itself a changed path.
      retriever: makeRetriever(['src/core/repository/repository.state.ts']),
      budgets: { diffChars: 0, fileContentChars: 0, repositoryContextChars: 0, totalContextChars: 0 },
    });

    const context = await composer.build(REPOSITORY_ROOT);
    const notes = context.truncation.notes.join('\n');

    expect(context.truncation.diffTruncated).toBe(true);
    expect(context.truncation.contentTruncated).toBe(true);
    expect(context.truncation.relatedContentTruncated).toBe(true);
    expect(notes).toContain('staged diff supplied to the reviewer is incomplete');
    expect(notes).toContain('content was limited');
    expect(notes).toContain('related file(s) were discovered but their content was not supplied');
  });

  it('records the budget configuration it used', async () => {
    const { composer } = makeComposer({ contents: {} });

    const context = await composer.build(REPOSITORY_ROOT);

    expect(context.truncation.budgets).toEqual(DEFAULT_CHANGE_CONTEXT_BUDGETS);
    expect(context.truncation.mandatoryChars).toBeGreaterThan(0);
    expect(context.truncation.suppliedChars).toBeGreaterThanOrEqual(context.truncation.mandatoryChars);
  });
});
