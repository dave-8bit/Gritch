import type { AIRequest } from '../core/ai/ai.types';

import { AIService } from '../core/ai/ai.service';

export async function chat(systemPrompt: string, userPrompt: string): Promise<string> {
  const request: AIRequest = {
    systemPrompt,
    userPrompt,
  };

  const response = await AIService.chat(request);
  return response.content;
}





