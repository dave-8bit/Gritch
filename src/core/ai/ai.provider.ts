import type { AIRequest, AIResponse } from './ai.types';

export interface AIProvider {
  chat(request: AIRequest): Promise<AIResponse>;
}

