import { describe, it, expect, vi } from 'vitest';

// Minimal debug test to understand what module id provider.registry uses for the CommonJS require.
// This file should not affect production behavior.
// If this test fails, it will print Vitest's module graph error.

vi.mock('../../src/providers/groq/groq.provider', () => ({
  GroqProvider: class { public readonly __mock = 'groq'; },
}));

vi.mock('../../src/providers/openrouter/openrouter.provider', () => ({
  OpenRouterProvider: class { public readonly __mock = 'openrouter'; },
}));

describe('provider.registry debug', () => {
  it('can import provider.registry', async () => {
    const mod = await import('../../src/core/ai/provider.registry');
    expect(typeof mod.getActiveProviderId).toBe('function');
  });
});

