import { describe, expect, it } from 'vitest';

import {
  REVIEW_MAX_ISSUES,
  isReviewPassed,
  isReviewResponseIncomplete,
  parseReviewResult,
  validateReviewResult,
  validateReviewIssueFile,
} from '../../../../src/core/ai/helpers/review-result';

/** A structurally valid raw response; individual tests mutate one field. */
function validRaw(): Record<string, unknown> {
  return {
    score: 8,
    summary: 'Adds staged-change evidence to the review prompt.',
    issues: [
      {
        severity: 'warning',
        category: 'bug',
        file: 'src/core/repository/change-evidence.ts',
        line: 10,
        endLine: 12,
        description: 'counts can be zero when statistics are missing',
        evidence: 'lineCountsAvailable is false for this record in the packet',
        suggestion: 'render unavailable instead of 0',
        confidence: 'high',
      },
    ],
  };
}

function validIssue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const issue = (validRaw().issues as Record<string, unknown>[])[0];
  return { ...issue, ...overrides };
}

function validateIssueField(overrides: Record<string, unknown>): string {
  const raw = validRaw();
  raw.issues = [validIssue(overrides)];
  const outcome = validateReviewResult(raw);
  expect(outcome.ok).toBe(false);
  return outcome.ok ? '' : outcome.error;
}

describe('validateReviewResult — valid responses', () => {
  it('accepts a complete response', () => {
    const outcome = validateReviewResult(validRaw());

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.score).toBe(8);
    expect(outcome.result.summary).toBe('Adds staged-change evidence to the review prompt.');
    expect(outcome.result.issues).toHaveLength(1);
    expect(outcome.result.issues[0]).toEqual({
      severity: 'warning',
      category: 'bug',
      file: 'src/core/repository/change-evidence.ts',
      line: 10,
      endLine: 12,
      description: 'counts can be zero when statistics are missing',
      evidence: 'lineCountsAvailable is false for this record in the packet',
      suggestion: 'render unavailable instead of 0',
      confidence: 'high',
    });
  });

  it('accepts an issue without optional line information', () => {
    const raw = validRaw();
    raw.issues = [validIssue({ line: undefined, endLine: undefined })];

    const outcome = validateReviewResult(raw);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.issues[0].line).toBeUndefined();
    expect('line' in outcome.result.issues[0]).toBe(false);
  });

  it('accepts an empty issues array', () => {
    const raw = validRaw();
    raw.issues = [];

    expect(validateReviewResult(raw).ok).toBe(true);
  });

  it('accepts every documented severity, category, and confidence', () => {
    const severities = ['critical', 'warning', 'info'];
    const categories = [
      'bug', 'security', 'performance', 'style', 'architecture', 'testing',
      'data-integrity', 'api', 'persistence', 'configuration', 'compatibility',
    ];
    const confidences = ['high', 'medium', 'low'];

    const issues = categories.map((category, index) => validIssue({
      severity: severities[index % severities.length],
      category,
      confidence: confidences[index % confidences.length],
    }));
    const raw = validRaw();
    raw.issues = issues;

    const outcome = validateReviewResult(raw);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.issues.map((issue) => issue.category)).toEqual(categories);
  });
});

describe('validateReviewResult — score contract', () => {
  it('accepts the boundary values 0 and 10', () => {
    for (const score of [0, 10]) {
      const raw = validRaw();
      raw.score = score;
      expect(validateReviewResult(raw).ok).toBe(true);
    }
  });

  it('accepts fractional scores inside the range', () => {
    const raw = validRaw();
    raw.score = 6.5;
    const outcome = validateReviewResult(raw);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.score).toBe(6.5);
  });

  it('rejects missing, non-numeric, and out-of-range scores', () => {
    const cases: unknown[] = [undefined, null, '8', Number.NaN, Number.POSITIVE_INFINITY, -0.1, 10.1, -1, 11];
    for (const score of cases) {
      const raw = validRaw();
      raw.score = score;
      expect(validateReviewResult(raw).ok).toBe(false);
    }
  });

  it('rejects a missing or empty summary', () => {
    const missing = validRaw();
    delete missing.summary;
    expect(validateReviewResult(missing).ok).toBe(false);

    const empty = validRaw();
    empty.summary = '   ';
    expect(validateReviewResult(empty).ok).toBe(false);
  });
});

describe('validateReviewResult — issue structure', () => {
  it('rejects a missing or non-array issues field', () => {
    const missing = validRaw();
    delete missing.issues;
    expect(validateReviewResult(missing).ok).toBe(false);

    const wrongType = validRaw();
    wrongType.issues = { file: 'src/a.ts' };
    expect(validateReviewResult(wrongType).ok).toBe(false);
  });

  it('rejects more issues than the contract allows', () => {
    const raw = validRaw();
    raw.issues = Array.from({ length: REVIEW_MAX_ISSUES + 1 }, () => validIssue());
    expect(validateReviewResult(raw).ok).toBe(false);
  });

  it('rejects issue entries that are not objects', () => {
    const raw = validRaw();
    raw.issues = ['src/a.ts'];
    expect(validateReviewResult(raw).ok).toBe(false);
  });

  it('rejects an invalid severity', () => {
    expect(validateIssueField({ severity: 'blocker' })).toContain('severity');
    expect(validateIssueField({ severity: undefined })).toContain('severity');
  });

  it('rejects an invalid category', () => {
    expect(validateIssueField({ category: 'nitpick' })).toContain('category');
    expect(validateIssueField({ category: undefined })).toContain('category');
  });

  it('rejects missing, empty, and non-concrete file values', () => {
    const rejected: unknown[] = [
      undefined,
      null,
      '',
      '   ',
      'unknown',
      'n/a',
      'all',
      'NONE',
      '<path>',
      'src/a.ts\nsrc/b.ts',
      '/etc/passwd',
      'C:\\Users\\david\\file.ts',
      '\\\\server\\share\\file.ts',
      '../outside.ts',
      'src/../../outside.ts',
    ];
    for (const file of rejected) {
      expect(validateIssueField({ file })).toContain('file');
    }
  });

  it('rejects a missing or empty evidence field', () => {
    expect(validateIssueField({ evidence: undefined })).toContain('evidence');
    expect(validateIssueField({ evidence: '  ' })).toContain('evidence');
  });

  it('rejects a missing description or suggestion', () => {
    expect(validateIssueField({ description: undefined })).toContain('description');
    expect(validateIssueField({ suggestion: '' })).toContain('suggestion');
  });

  it('rejects an invalid confidence', () => {
    expect(validateIssueField({ confidence: 'certain' })).toContain('confidence');
    expect(validateIssueField({ confidence: undefined })).toContain('confidence');
  });

  it('rejects malformed line and endLine values', () => {
    expect(validateIssueField({ line: 0 })).toContain('line');
    expect(validateIssueField({ line: -3 })).toContain('line');
    expect(validateIssueField({ line: 1.5 })).toContain('line');
    expect(validateIssueField({ line: '3' })).toContain('line');
    expect(validateIssueField({ endLine: 0 })).toContain('endLine');
    expect(validateIssueField({ line: 10, endLine: 4 })).toContain('endLine');
  });

describe('validateReviewResult — top-level shape', () => {
  it('rejects non-object responses', () => {
    for (const raw of [null, undefined, 5, 'text', [], true]) {
      expect(validateReviewResult(raw).ok).toBe(false);
    }
  });

  it('rejects a passed field instead of trusting it', () => {
    // The application derives pass/fail; a model-provided `passed` is ignored
    // rather than trusted.
    const raw = validRaw();
    raw.passed = false;
    raw.score = 9;

    const outcome = validateReviewResult(raw);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect('passed' in outcome.result).toBe(false);
    expect(isReviewPassed(outcome.result.score, 7)).toBe(true);
  });
});

describe('parseReviewResult — JSON handling', () => {
  it('parses bare JSON', () => {
    const outcome = parseReviewResult(JSON.stringify(validRaw()));
    expect(outcome.ok).toBe(true);
  });

  it('parses fenced JSON', () => {
    const outcome = parseReviewResult('```json\n' + JSON.stringify(validRaw()) + '\n```');
    expect(outcome.ok).toBe(true);
  });

  it('reports malformed JSON as a validation failure', () => {
    const outcome = parseReviewResult('{ "score": 8, "summary": ');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toContain('JSON');
  });

  it('reports valid JSON that is not a review object', () => {
    expect(parseReviewResult('[]').ok).toBe(false);
    expect(parseReviewResult('5').ok).toBe(false);
    expect(parseReviewResult('null').ok).toBe(false);
  });
});

describe('path and finish-reason helpers', () => {
  it('normalizes concrete repository paths and rejects escapes', () => {
    expect(validateReviewIssueFile('src\\\\core\\\\a.ts')).toBe('src/core/a.ts');
    expect(validateReviewIssueFile('./src/a.ts')).toBe('src/a.ts');
    expect(validateReviewIssueFile('src/./a.ts')).toBe('src/a.ts');
    expect(validateReviewIssueFile('Makefile')).toBe('Makefile');
    expect(validateReviewIssueFile('')).toBeUndefined();
    expect(validateReviewIssueFile('..')).toBeUndefined();
  });

  it('detects truncated responses from the provider finish reason', () => {
    expect(isReviewResponseIncomplete({ content: 'x', metadata: { finishReason: 'length' } })).toBe(true);
    expect(isReviewResponseIncomplete({ content: 'x', metadata: { finishReason: 'MAX_TOKENS' } })).toBe(true);
    expect(isReviewResponseIncomplete({ content: 'x', metadata: { finishReason: 'max_output_tokens' } })).toBe(true);
    expect(isReviewResponseIncomplete({ content: 'x', metadata: { finishReason: 'stop' } })).toBe(false);
    expect(isReviewResponseIncomplete({ content: 'x', metadata: { finishReason: 'STOP' } })).toBe(false);
    expect(isReviewResponseIncomplete({ content: 'x', metadata: {} })).toBe(false);
    expect(isReviewResponseIncomplete({ content: 'x' })).toBe(false);
  });

  it('derives pass/fail from the score and threshold', () => {
    expect(isReviewPassed(7, 7)).toBe(true);
    expect(isReviewPassed(6.9, 7)).toBe(false);
    expect(isReviewPassed(10, 7)).toBe(true);
    expect(isReviewPassed(6, 5)).toBe(true);
    expect(isReviewPassed(5, 6)).toBe(false);
  });
});

});
