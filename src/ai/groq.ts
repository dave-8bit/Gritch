import type { AIRequest } from '../core/ai/ai.types';

import { GroqProvider } from '../providers/groq/groq.provider';

const provider = new GroqProvider();

export async function chat(systemPrompt: string, userPrompt: string): Promise<string> {
  const request: AIRequest = {
    systemPrompt,
    userPrompt,
  };

  const response = await provider.chat(request);
  return response.content;
}


