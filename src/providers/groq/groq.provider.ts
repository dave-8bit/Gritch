import Groq from 'groq-sdk';

import type { AIProvider } from '../../core/ai/ai.provider';
import type { AIRequest, AIResponse } from '../../core/ai/ai.types';

import { requireApiKey } from '../../core/ai/helpers/api-key';
import { assembleAIResponse } from '../../core/ai/helpers/response';

const apiKey = process.env.GROQ_API_KEY;

const groq = new Groq({
  apiKey: apiKey ?? '',
});

export class GroqProvider implements AIProvider {
  async chat(request: AIRequest): Promise<AIResponse> {
    // Fail fast before making any API request.
    requireApiKey(apiKey, 'GROQ_API_KEY');


    const completion = await groq.chat.completions.create({
      model: request.model ?? 'llama-3.3-70b-versatile',

      max_tokens: request.maxTokens ?? 1024,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
    });

    const content = completion.choices?.[0]?.message?.content ?? '';

    const metadata = {
      provider: 'groq',
      model: completion.model,
      finishReason: completion.choices?.[0]?.finish_reason,
      usage: completion.usage
        ? {
            promptTokens: completion.usage.prompt_tokens,
            completionTokens: completion.usage.completion_tokens,
            totalTokens: completion.usage.total_tokens,
          }
        : undefined,
    };

    // Only include fields that are actually available.
    const filteredMetadata = Object.fromEntries(
      Object.entries(metadata).filter(([, v]) => v !== undefined)
    ) as typeof metadata;

    return assembleAIResponse(content, filteredMetadata);
  }
}




