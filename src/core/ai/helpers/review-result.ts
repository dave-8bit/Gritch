import { normalizeRepositoryPath } from '../../repository/repository.file-index';
import { parseJSONResponse } from './response';

/**
 * Validated review result contract.
 *
 * The model produces JSON, but the model is not trusted: everything it returns
 * is validated field by field before the review is presented. In particular:
 *
 * - `passed` is NOT part of the contract. The application derives pass/fail
 *   from the score and the configured threshold.
 * - Every issue must name a concrete repository-relative path. The old
 *   `file: ""` sentinel is rejected.
 * - Every issue must carry evidence explaining why the supplied material
 *   supports the finding.
 * - Scores must be finite numbers inside 0–10.
 */

export const REVIEW_SCORE_MIN = 0;
export const REVIEW_SCORE_MAX = 10;

/** Maximum number of issues accepted from a single response. */
export const REVIEW_MAX_ISSUES = 50;

export const REVIEW_SEVERITIES = ['critical', 'warning', 'info'] as const;
export const REVIEW_CATEGORIES = [
  'bug',
  'security',
  'performance',
  'style',
  'architecture',
  'testing',
  'data-integrity',
  'api',
  'persistence',
  'configuration',
  'compatibility',
] as const;
export const REVIEW_CONFIDENCES = ['high', 'medium', 'low'] as const;

export type ReviewIssueSeverity = (typeof REVIEW_SEVERITIES)[number];
export type ReviewIssueCategory = (typeof REVIEW_CATEGORIES)[number];
export type ReviewConfidence = (typeof REVIEW_CONFIDENCES)[number];

export interface ReviewIssue {
  severity: ReviewIssueSeverity;
  category: ReviewIssueCategory;
  /** Concrete repository-relative path of an actually changed file. */
  file: string;
  line?: number;
  endLine?: number;
  description: string;
  /** Why the supplied evidence supports this finding. */
  evidence: string;
  suggestion: string;
  confidence: ReviewConfidence;
}

export interface ValidatedReviewResult {
  score: number;
  summary: string;
  issues: ReviewIssue[];
}

export type ReviewValidationResult =
  | { ok: true; result: ValidatedReviewResult }
  | { ok: false; error: string };

/**
 * Values that are not paths, seen from real model output. Compared against the
 * lowercased, trimmed file value.
 */
const NON_CONCRETE_FILE_VALUES: ReadonlySet<string> = new Set([
  '',
  '-',
  '--',
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
  'unknown',
  'all',
  'any',
  'multiple',
  'various',
  'several',
  'the codebase',
  'codebase',
  'repository',
  'repo',
  'tbd',
  'todo',
]);

function fail(error: string): ReviewValidationResult {
  return { ok: false, error };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function validateNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * A concrete repository path: relative, non-empty, not a placeholder, not
 * absolute, and free of traversal segments.
 */
export function validateReviewIssueFile(value: unknown): string | undefined {
  const raw = validateNonEmptyString(value);
  if (raw === undefined) return undefined;
  if (raw.includes('\0') || /[\r\n]/.test(raw)) return undefined;
  if (NON_CONCRETE_FILE_VALUES.has(raw.toLowerCase())) return undefined;
  if (raw.includes('<') || raw.includes('>')) return undefined;

  // Reject absolute paths written with either separator.
  if (/^[A-Za-z]:/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('/') || raw.startsWith('\\')) {
    return undefined;
  }

  const normalized = normalizeRepositoryPath(raw);
  if (!normalized) return undefined;

  const segments = normalized.split('/');
  if (segments.includes('..')) return undefined;

  return normalized;
}

function validateLine(value: unknown): number | undefined | false {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return false;
  return value;
}

function validateIssue(value: unknown, index: number): ReviewIssue | string {
  const prefix = `issues[${index}]`;
  if (!isPlainRecord(value)) return `${prefix} must be an object`;

  if (!isOneOf(value.severity, REVIEW_SEVERITIES)) {
    return `${prefix}.severity must be one of: ${REVIEW_SEVERITIES.join(', ')}`;
  }
  if (!isOneOf(value.category, REVIEW_CATEGORIES)) {
    return `${prefix}.category must be one of: ${REVIEW_CATEGORIES.join(', ')}`;
  }

  const file = validateReviewIssueFile(value.file);
  if (file === undefined) {
    return `${prefix}.file must be a concrete repository-relative path`;
  }

  const description = validateNonEmptyString(value.description);
  if (description === undefined) return `${prefix}.description must be a non-empty string`;

  const evidence = validateNonEmptyString(value.evidence);
  if (evidence === undefined) return `${prefix}.evidence must be a non-empty string`;

  const suggestion = validateNonEmptyString(value.suggestion);
  if (suggestion === undefined) return `${prefix}.suggestion must be a non-empty string`;

  if (!isOneOf(value.confidence, REVIEW_CONFIDENCES)) {
    return `${prefix}.confidence must be one of: ${REVIEW_CONFIDENCES.join(', ')}`;
  }

  const line = validateLine(value.line);
  if (line === false) return `${prefix}.line must be a positive integer`;
  const endLine = validateLine(value.endLine);
  if (endLine === false) return `${prefix}.endLine must be a positive integer`;
  if (typeof line === 'number' && typeof endLine === 'number' && endLine < line) {
    return `${prefix}.endLine must not be smaller than line`;
  }

  const issue: ReviewIssue = {
    severity: value.severity,
    category: value.category,
    file,
    description,
    evidence,
    suggestion,
    confidence: value.confidence,
  };
  if (typeof line === 'number') issue.line = line;
  if (typeof endLine === 'number') issue.endLine = endLine;
  return issue;
}

/** Validates an unknown value against the review contract. */
export function validateReviewResult(raw: unknown): ReviewValidationResult {
  if (!isPlainRecord(raw)) {
    return fail('response must be a JSON object');
  }

  const score = raw.score;
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return fail('score must be a finite number');
  }
  if (score < REVIEW_SCORE_MIN || score > REVIEW_SCORE_MAX) {
    return fail(`score must be between ${REVIEW_SCORE_MIN} and ${REVIEW_SCORE_MAX}`);
  }

  const summary = validateNonEmptyString(raw.summary);
  if (summary === undefined) return fail('summary must be a non-empty string');

  if (!Array.isArray(raw.issues)) {
    return fail('issues must be an array');
  }
  if (raw.issues.length > REVIEW_MAX_ISSUES) {
    return fail(`issues must contain at most ${REVIEW_MAX_ISSUES} entries`);
  }

  const issues: ReviewIssue[] = [];
  for (let index = 0; index < raw.issues.length; index += 1) {
    const issue = validateIssue(raw.issues[index], index);
    if (typeof issue === 'string') return fail(issue);
    issues.push(issue);
  }

  return { ok: true, result: { score, summary, issues } };
}

/**
 * Parses and validates a model response. Malformed JSON is reported as a
 * validation failure, never thrown at the caller.
 */
export function parseReviewResult(raw: string): ReviewValidationResult {
  let parsed: unknown;
  try {
    parsed = parseJSONResponse<unknown>(raw);
  } catch {
    return fail('response is not valid JSON');
  }
  return validateReviewResult(parsed);
}

/** Finish reasons that mean the model stopped because it ran out of output. */
const INCOMPLETE_FINISH_REASONS: ReadonlySet<string> = new Set([
  'length',
  'maxtoken',
  'maxtokens',
  'maxoutputtokens',
  'tokenlimit',
]);

export const REVIEW_TRUNCATED_MESSAGE =
  'The review response was cut off before it completed (output length limit reached).';

/**
 * True when the provider reported that generation stopped because of an output
 * length/token limit. Such a response is an incomplete review and must not be
 * presented as a final result.
 */
export function isReviewResponseIncomplete(response: {
  content: string;
  metadata?: { finishReason?: string };
}): boolean {
  const reason = response.metadata?.finishReason;
  if (typeof reason !== 'string' || reason.trim() === '') return false;
  return INCOMPLETE_FINISH_REASONS.has(reason.toLowerCase().replace(/[^a-z]/g, ''));
}

/** Deterministic pass/fail calculation owned by the application. */
export function isReviewPassed(score: number, threshold: number): boolean {
  return score >= threshold;
}