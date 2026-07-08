import type { AIProvider } from './ai.provider';
import type { AIRequest, AIResponse } from './ai.types';
import { GroqProvider } from '../../providers/groq/groq.provider';

class AIServiceImpl {
  private readonly defaultProvider: AIProvider;

  constructor() {
    // Preserve existing runtime behavior: provider instantiated once at module load time.
    this.defaultProvider = new GroqProvider();
  }

  async chat(request: AIRequest): Promise<AIResponse> {
    // Preserve error propagation semantics by not catching.
    return this.defaultProvider.chat(request);
  }
}

// Singleton instance to act as a stable single entry point.
export const AIService = new AIServiceImpl();

