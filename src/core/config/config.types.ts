export interface GritchConfig {
  /**
   * Optional: active AI provider identifier.
   * When omitted, runtime should fall back to the default provider (Groq).
   */
  provider?: string;

  model: string;
  maxTokens: number;
  reviewThreshold: number;
  conventionalCommits: boolean;
}



// Legacy alias (deprecated): kept for backward compatibility

// eslint-disable-next-line @typescript-eslint/naming-convention
export type GitwiseConfig = GritchConfig;


