import Groq from 'groq-sdk';

import type { AIProvider } from '../../core/ai/ai.provider';
import type { AIRequest, AIResponse } from '../../core/ai/ai.types';

const apiKey = process.env.GROQ_API_KEY;

function assertApiKey(): string {
  const key = apiKey ?? '';
  if (!key) {
    // Match OpenRouterProvider style: fail fast with a clear error.
    throw new Error('Missing GROQ_API_KEY');
  }
  return key;
}

const groq = new Groq({
  apiKey: apiKey ?? '',
});


function toAIResponse(content: string): AIResponse {
  return { content };
}

export class GroqProvider implements AIProvider {
  async chat(request: AIRequest): Promise<AIResponse> {
    // Fail fast before making any API request.
    assertApiKey();

    const completion = await groq.chat.completions.create({
      model: request.model ?? 'llama-3.3-70b-versatile',

      max_tokens: request.maxTokens ?? 1024,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
    });

    const content = completion.choices?.[0]?.message?.content ?? '';
    return toAIResponse(content);
  }
}

