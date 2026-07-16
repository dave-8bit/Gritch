import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Provider registry module-loads providers.
vi.mock('../../src/providers/groq/groq.provider', () => {
  class GroqProviderMock {
    public readonly __mock = 'groq';
  }
  return { GroqProvider: GroqProviderMock };
});

vi.mock('../../src/providers/openrouter/openrouter.provider', () => {
  class OpenRouterProviderMock {
    public readonly __mock = 'openrouter';
  }
  return { OpenRouterProvider: OpenRouterProviderMock };
});

type Provider = 'groq' | 'openrouter' | 'gemini';


const mockLoadConfig = vi.fn();

// provider.registry.ts uses CommonJS require('../config/config.service') from within src/core/ai.
// That require resolves to src/core/config/config.service.js/ts depending on transform.
// We mock the resolved path specifier Vitest will use for that require: '../../src/core/config/config.service'.
vi.mock('../../src/core/config/config.service', () => {
  return {
    defaultConfig: { provider: 'groq' as Provider },
    loadConfig: mockLoadConfig,
  };
});

describe('Provider registry', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    mockLoadConfig.mockReset();
    delete process.env.GRITCH_PROVIDER;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const importRegistry = async () => import('../../src/core/ai/provider.registry');

  it("returns Groq provider when GRITCH_PROVIDER='groq'", async () => {

    process.env.GRITCH_PROVIDER = 'groq';
    mockLoadConfig.mockReturnValue({ provider: 'openrouter' });

    const mod = await importRegistry();

    const id = mod.getActiveProviderId();
    const provider = mod.getActiveProvider();

    expect(id).toBe('groq');
    expect((provider as any).__mock).toBe('groq');

  });

  it("returns OpenRouter provider when GRITCH_PROVIDER='openrouter'", async () => {
    process.env.GRITCH_PROVIDER = 'openrouter';
    mockLoadConfig.mockReturnValue({ provider: 'groq' });

    const mod = await importRegistry();

    expect(mod.getActiveProviderId()).toBe('openrouter');
    expect((mod.getActiveProvider() as any).__mock).toBe('openrouter');
  });

  it('unsupported GRITCH_PROVIDER falls back to Groq', async () => {
    process.env.GRITCH_PROVIDER = 'unsupported-provider';
    mockLoadConfig.mockReturnValue({ provider: 'openrouter' });


    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await importRegistry();

    expect(mod.getActiveProviderId()).toBe('groq');
    expect((mod.getActiveProvider() as any).__mock).toBe('groq');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'WARNING: Unsupported GRITCH_PROVIDER="unsupported-provider"; falling back to "groq".'
    );
  });

  it("when env is unset, uses config.provider='groq'", async () => {
    mockLoadConfig.mockReturnValue({ provider: 'groq' });

    const mod = await importRegistry();

    expect(mod.getActiveProviderId()).toBe('groq');
    expect((mod.getActiveProvider() as any).__mock).toBe('groq');
  });

  it("when env is unset, uses config.provider='openrouter'", async () => {
    mockLoadConfig.mockReturnValue({ provider: 'openrouter' });

    const mod = await importRegistry();

    expect(mod.getActiveProviderId()).toBe('openrouter');
    expect((mod.getActiveProvider() as any).__mock).toBe('openrouter');
  });

  it('invalid config provider falls back to Groq', async () => {
    mockLoadConfig.mockReturnValue({ provider: 'nope' });

    const mod = await importRegistry();

    expect(mod.getActiveProviderId()).toBe('groq');
    expect((mod.getActiveProvider() as any).__mock).toBe('groq');
  });

  it('missing config provider falls back to Groq', async () => {
    mockLoadConfig.mockReturnValue({});

    const mod = await importRegistry();

    expect(mod.getActiveProviderId()).toBe('groq');
    expect((mod.getActiveProvider() as any).__mock).toBe('groq');
  });

  it('environment variable overrides config value', async () => {
    process.env.GRITCH_PROVIDER = 'groq';
    mockLoadConfig.mockReturnValue({ provider: 'openrouter' });

    const mod = await importRegistry();

    expect(mod.getActiveProviderId()).toBe('groq');
    expect((mod.getActiveProvider() as any).__mock).toBe('groq');
  });

  it('unsupported env value emits the expected warning exactly once', async () => {
    process.env.GRITCH_PROVIDER = 'not-a-real-provider';
    mockLoadConfig.mockReturnValue({ provider: 'openrouter' });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await importRegistry();

    // Evaluate both once; implementation may re-run getActiveProviderId.
    expect(mod.getActiveProviderId()).toBe('groq');
    expect((mod.getActiveProvider() as any).__mock).toBe('groq');

    // Requirement: warning should be emitted exactly once for the unsupported env value.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'WARNING: Unsupported GRITCH_PROVIDER="not-a-real-provider"; falling back to "groq".'
    );
  });


  it('getActiveProvider() returns the provider corresponding to getActiveProviderId()', async () => {
    process.env.GRITCH_PROVIDER = 'openrouter';
    mockLoadConfig.mockReturnValue({ provider: 'groq' });

    const mod = await importRegistry();

    const id = mod.getActiveProviderId();
    const provider = mod.getActiveProvider();

    expect((provider as any).__mock).toBe(id);
  });
});

