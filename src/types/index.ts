export interface CommitResult {
  message: string;
  type: string;
  scope?: string;
  description: string;
}

import type { ValidatedReviewResult } from '../core/ai/helpers/review-result';

/**
 * Public review issue contract.
 *
 * Re-exported from the validated AI response contract (`review-result.ts`):
 * every issue names a concrete repository-relative path, carries evidence
 * explaining why the supplied material supports the finding, and states a
 * confidence. The model output is validated field by field before any value
 * with this type exists.
 */
export type {
  ReviewIssue,
  ReviewConfidence,
  ReviewIssueCategory,
  ReviewIssueSeverity,
} from '../core/ai/helpers/review-result';

/**
 * Final review result presented to the user.
 *
 * `passed` is NOT part of the AI contract: the model never returns it. The
 * application derives it deterministically from the validated score and the
 * configured review threshold (`passed = score >= reviewThreshold`).
 */
export interface ReviewResult extends ValidatedReviewResult {
  /** Application-derived: validated score >= configured review threshold. */
  passed: boolean;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  content: string;
}

export interface ExplainResult {
  summary: string;
  filesChanged: string[];
  impact: string;
  details: string;
}

export type { GritchConfig, GitwiseConfig } from '../core/config/config.types';

