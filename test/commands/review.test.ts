import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { ChangeContext } from '../../src/core/repository/change-context';

const { composeChangeContextMock, chatWithFallbackMock } = vi.hoisted(() => ({
  composeChangeContextMock: vi.fn<() => Promise<ChangeContext>>(),
  chatWithFallbackMock: vi.fn(),
}));

vi.mock('../../src/core/repository/change-context', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/repository/change-context')>(
    '../../src/core/repository/change-context',
  );
  return {
    ...actual,
    composeChangeContext: composeChangeContextMock,
  };
});

vi.mock('../../src/core/repository/repository.retriever', () => ({
  createExistingIndexRetriever: vi.fn(() => undefined),
}));

vi.mock('../../src/core/ai/ai.service', () => ({
  AIService: {
    chatWithFallback: chatWithFallbackMock,
  },
}));

vi.mock('../../src/core/ai/ai.request-builder', () => ({
  buildAIRequest: vi.fn((request: unknown) => request),
}));

vi.mock('../../src/utils/git', () => ({
  validateRepo: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/config', () => ({
  loadConfig: vi.fn(() => ({ reviewThreshold: 7 })),
}));

vi.mock('../../src/utils/display', () => ({
  spinner: {
    text: '',
    start: vi.fn(),
    stop: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  },
  printError: vi.fn(),
  printHeader: vi.fn(),
  printInfo: vi.fn(),
  printDivider: vi.fn(),
  printSuccess: vi.fn(),
  printWarning: vi.fn(),
  printReviewIssue: vi.fn(),
}));

import { reviewCommand } from '../../src/commands/review';

function makeContext(): ChangeContext {
  const record = {
    path: 'src/feature.ts',
    status: 'modified' as const,
    lineCountsAvailable: true,
    insertions: 3,
    deletions: 1,
    changes: 4,
    binary: false,
    extension: '.ts',
    category: 'source' as const,
    subsystem: 'src',
    conflicted: false,
  };

  return {
    overview: {
      evidence: {
        schemaVersion: 1,
        repository: {
          root: 'C:\\repo',
          key: 'C:\\repo',
          headRevision: 'head',
          worktreeState: 'dirty',
        },
        identitySource: 'staged-diff',
        degradations: [],
        totals: {
          lineCountsAvailable: true,
          filesMissingLineCounts: 0,
          unmatchedStatisticsFiles: 0,
          files: 1,
          insertions: 3,
          deletions: 1,
          binaryFiles: 0,
          byStatus: { modified: 1, added: 0, deleted: 0, renamed: 0, copied: 0, typechanged: 0, unmerged: 0 },
        },
        signals: {
          hasTests: false,
          hasConfiguration: false,
          hasMigration: false,
          hasDependencyChange: false,
          hasDocumentation: false,
          hasBinary: false,
          hasRenameOrCopy: false,
          hasDeletion: false,
          hasConflict: false,
          categories: ['source'],
          subsystems: ['src'],
        },
        tier: 'moderate',
        tierReasons: ['source change'],
      },
      fileCount: 1,
      relatedFileLookup: 'not-performed',
      notes: ['No related-file lookup was performed.'],
    },
    files: [{
      record,
      contentStatus: 'supplied',
      relatedFileLookup: 'not-performed',
      relatedFiles: [],
    }],
    relatedFiles: [],
    contents: [{
      path: record.path,
      role: 'changed-file',
      content: 'export function feature() { return true; }\n',
      sizeBytes: 44,
      status: 'supplied',
    }],
    diffSections: {
      status: 'available',
      sections: [{
        path: record.path,
        label: record.path,
        header: `diff --git a/${record.path} b/${record.path}`,
        hunks: '@@ -1 +1,3 @@\n+export function feature() { return true; }',
        totalHunks: 1,
        includedHunks: 1,
        complete: true,
      }],
      omittedSections: [],
      complete: true,
      notes: ['The complete staged diff was supplied, split by file section.'],
    },
    repositoryFacts: {
      profileUnavailable: false,
      groups: [{ reason: 'source change', facts: ['TypeScript repository'] }],
      notes: [],
    },
    truncation: {
      diffTruncated: false,
      contentTruncated: false,
      relatedContentTruncated: false,
      repositoryFactsTruncated: false,
      budgets: {
        diffChars: 12000,
        fileContentChars: 16000,
        perFileContentChars: 4000,
        repositoryContextChars: 800,
        totalContextChars: 32000,
      },
      mandatoryChars: 100,
      suppliedChars: 500,
      notes: ['No evidence was truncated: every changed file and the complete staged diff were supplied.'],
    },
  };
}

describe('reviewCommand evidence integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    composeChangeContextMock.mockResolvedValue(makeContext());
    chatWithFallbackMock.mockResolvedValue({
      content: JSON.stringify({ score: 8, summary: 'Evidence-backed review', issues: [] }),
    });
  });

  it('passes the constructed change context through the rendered prompt to AI', async () => {
    await reviewCommand();

    expect(composeChangeContextMock).toHaveBeenCalledWith(undefined, { retriever: undefined });
    expect(chatWithFallbackMock).toHaveBeenCalledTimes(1);
    const request = chatWithFallbackMock.mock.calls[0][0];
    expect(request.userPrompt).toContain('Change overview (deterministic evidence)');
    expect(request.userPrompt).toContain('src/feature.ts');
    expect(request.userPrompt).toContain('status: modified');
    expect(request.userPrompt).toContain('line counts: available (insertions 3, deletions 1, changes 4)');
    expect(request.userPrompt).toContain('category: source');
    expect(request.userPrompt).toContain('subsystem: src');
    expect(request.userPrompt).toContain('Staged diff (index vs HEAD)');
    expect(request.userPrompt).toContain('export function feature()');
    expect(request.userPrompt).toContain('Evidence limitations');
  });
});
