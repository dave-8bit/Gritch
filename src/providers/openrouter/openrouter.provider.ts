import type { AIProvider } from '../../core/ai/ai.provider';
import type { AIRequest, AIResponse } from '../../core/ai/ai.types';

// OpenRouter follows an OpenAI-compatible chat API.
// We use the minimal required surface: system+user prompts.
const apiKey = process.env.OPENROUTER_API_KEY;

function toAIResponse(content: string): AIResponse {
  return { content };
}

function assertApiKey(): string {
  const key = apiKey ?? '';
  if (!key) {
    // Avoid pulling in a shared error utility; keep behavior consistent with GroqProvider.
    throw new Error('Missing OPENROUTER_API_KEY');
  }
  return key;
}

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
    const key = assertApiKey();

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
      const text = await response.text().catch(() => '');
      throw new Error(`OpenRouter request failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
    }

    const json = (await response.json()) as OpenRouterChatCompletionResponse;
    const content = json.choices?.[0]?.message?.content ?? '';

    return toAIResponse(content);
  }
}

