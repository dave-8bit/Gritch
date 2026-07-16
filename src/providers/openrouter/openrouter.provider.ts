import type { AIProvider } from '../../core/ai/ai.provider';
import type { AIRequest, AIResponse } from '../../core/ai/ai.types';

import { requireApiKey } from '../../core/ai/helpers/api-key';
import { assembleAIResponse } from '../../core/ai/helpers/response';
import { throwFetchHttpError } from '../../core/ai/helpers/http-error';

// OpenRouter follows an OpenAI-compatible chat API.
// We use the minimal required surface: system+user prompts.
const apiKey = process.env.OPENROUTER_API_KEY;

type OpenRouterChatCompletionResponse = {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string;
    };
  }>;
};

export class OpenRouterProvider implements AIProvider {
  async chat(request: AIRequest): Promise<AIResponse> {
    const key = requireApiKey(apiKey, 'OPENROUTER_API_KEY');


    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model ?? 'openai/gpt-3.5-turbo',
        max_tokens: request.maxTokens ?? 1024,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      await throwFetchHttpError({
        response,
        prefix: 'OpenRouter request failed',
      });
    }

    const json = (await response.json()) as OpenRouterChatCompletionResponse;
    const content = json.choices?.[0]?.message?.content ?? '';

    return assembleAIResponse(content);
  }
}


