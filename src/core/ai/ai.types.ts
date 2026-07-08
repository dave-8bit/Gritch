export interface AIRequest {
  systemPrompt: string;
  userPrompt: string;
  /**
   * Model selection hint. Providers may ignore if not supported.
   */
  model?: string;
  /**
   * Provider/vendor-specific generation tuning.
   * Kept optional to avoid breaking when different providers are introduced.
   */
  maxTokens?: number;
}

export interface AIUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AIResponseMetadata {
  /**
   * Provider identifier (e.g., "groq").
   * Intentionally provider-agnostic.
   */
  provider?: string;
  model?: string;
  finishReason?: string;
  usage?: AIUsage;
}

export interface AIResponse {
  /** Main content returned by the provider. */
  content: string;
  metadata?: AIResponseMetadata;
}

