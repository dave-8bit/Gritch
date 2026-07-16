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
    return assembleAIResponse(content);
  }
}



