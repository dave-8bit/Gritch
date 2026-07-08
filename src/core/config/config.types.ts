export interface GritchConfig {
  model: string;
  maxTokens: number;
  reviewThreshold: number;
  conventionalCommits: boolean;
}

// Legacy alias (deprecated): kept for backward compatibility
// eslint-disable-next-line @typescript-eslint/naming-convention
export type GitwiseConfig = GritchConfig;


