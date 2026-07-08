export interface CommitResult {
  message: string;
  type: string;
  scope?: string;
  description: string;
}

export interface ReviewIssue {
  severity: 'critical' | 'warning' | 'info';
  category: 'bug' | 'security' | 'performance' | 'style';
  line?: number;
  description: string;
  suggestion: string;
}

export interface ReviewResult {
  score: number;
  summary: string;
  issues: ReviewIssue[];
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

