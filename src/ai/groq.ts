import Groq from 'groq-sdk';

const apiKey = process.env.GROQ_API_KEY;

export const groq = new Groq({
  apiKey: apiKey ?? '',
});

export async function chat(systemPrompt: string, userPrompt: string): Promise<string> {
  const completion = await groq.chat.completions.create({
    model: 'llama3-70b-8192',
    max_tokens: 1024,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  return completion.choices?.[0]?.message?.content ?? '';
}

