import type { AIResponse, AIResponseMetadata } from '../ai.types';

export function assembleAIResponse(content: string, metadata?: AIResponseMetadata): AIResponse {
  return metadata ? { content, metadata } : { content };
}


