import type { AIRequest, AIResponse } from './ai.types';
import { getActiveProvider } from './provider.registry';

class AIServiceImpl {
  async chat(request: AIRequest): Promise<AIResponse> {
    // Preserve error propagation semantics by not catching.
    return getActiveProvider().chat(request);
  }
}

// Singleton instance to act as a stable single entry point.
export const AIService = new AIServiceImpl();


