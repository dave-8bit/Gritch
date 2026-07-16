import type { AIRequest } from './ai.types';

import { loadConfig } from '../config/config.service';

/**
 * Centralized AIRequest construction.
 *
 * Ensures model/maxTokens from configuration are propagated consistently
 * into every provider call.
 */
export function buildAIRequest(params: {
  systemPrompt: string;
  userPrompt: string;
}): AIRequest {
  const config = loadConfig();

  return {
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    model: config.model,
    maxTokens: config.maxTokens,
  };
}

