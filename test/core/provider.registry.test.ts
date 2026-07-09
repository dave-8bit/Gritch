import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Helpers ----
function mockProviders() {
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
}


const mockConfigService = {
  defaultConfig: { provider: 'groq' },
  loadConfig: vi.fn(),
};

function setMockConfig(config: any) {
  mockConfigService.loadConfig.mockImplementation(() => config);
}


vi.mock('../../src/core/config/config.service.ts', () => mockConfigService);






// ---- Module mocks ----
// Providers are instantiated at module load time, so they must be defined before importing
// provider.registry.
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

function mockLoadConfig(config: any) {
  setMockConfig(config);
}

describe('Provider registry', () => {
  const warnText =
    'WARNING: Unsupported GRITCH_PROVIDER="SOME_VALUE"; falling back to "groq".';


  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.GRITCH_PROVIDER;
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns Groq provider when GRITCH_PROVIDER=groq', async () => {
    vi.resetModules();
    mockProviders();
    mockLoadConfig({ provider: 'openrouter' });

    process.env.GRITCH_PROVIDER = 'groq';
    const mod = await import('../../src/core/ai/provider.registry');

    const id = mod.getActiveProviderId();
    const p = mod.getActiveProvider();

    expect(id).toBe('groq');
    expect((p as any).__mock).toBe('groq');
  });

  it('returns OpenRouter provider when GRITCH_PROVIDER=openrouter', async () => {
    vi.resetModules();
    mockProviders();
    mockLoadConfig({ provider: 'groq' });

    process.env.GRITCH_PROVIDER = 'openrouter';
    const mod = await import('../../src/core/ai/provider.registry');

    const id = mod.getActiveProviderId();
    const p = mod.getActiveProvider();

    expect(id).toBe('openrouter');
    expect((p as any).__mock).toBe('openrouter');
  });

  it('unsupported GRITCH_PROVIDER falls back to Groq (warning emitted once)', async () => {
    vi.resetModules();
    mockProviders();
    mockLoadConfig({ provider: 'openrouter' });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    process.env.GRITCH_PROVIDER = 'unsupported-provider';
    const mod = await import('../../src/core/ai/provider.registry');

    // Call getActiveProvider multiple times to ensure warning happens exactly once.
    const id1 = mod.getActiveProviderId();
    const p1 = mod.getActiveProvider();
    const id2 = mod.getActiveProviderId();
    const p2 = mod.getActiveProvider();

    expect(id1).toBe('groq');
    expect(id2).toBe('groq');
    expect((p1 as any).__mock).toBe('groq');
    expect((p2 as any).__mock).toBe('groq');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      `WARNING: Unsupported GRITCH_PROVIDER="unsupported-provider"; falling back to "groq".`
    );
  });

  it('when env is unset, uses config.provider="groq"', async () => {
    vi.resetModules();
    mockProviders();
    mockLoadConfig({ provider: 'groq' });

    const mod = await import('../../src/core/ai/provider.registry');

    const id = mod.getActiveProviderId();
    const p = mod.getActiveProvider();

    expect(id).toBe('groq');
    expect((p as any).__mock).toBe('groq');
  });

  it('when env is unset, uses config.provider="openrouter"', async () => {
    vi.resetModules();
    mockProviders();
    mockLoadConfig({ provider: 'openrouter' });

    const mod = await import('../../src/core/ai/provider.registry');

    const id = mod.getActiveProviderId();
    const p = mod.getActiveProvider();

    expect(id).toBe('openrouter');
    expect((p as any).__mock).toBe('openrouter');
  });

  it('invalid config provider falls back to Groq', async () => {
    vi.resetModules();
    mockProviders();
    mockLoadConfig({ provider: 'nope' });

    const mod = await import('../../src/core/ai/provider.registry');

    const id = mod.getActiveProviderId();
    const p = mod.getActiveProvider();

    expect(id).toBe('groq');
    expect((p as any).__mock).toBe('groq');
  });

  it('missing config provider falls back to Groq', async () => {
    vi.resetModules();
    mockProviders();
    mockLoadConfig({});

    const mod = await import('../../src/core/ai/provider.registry');

    const id = mod.getActiveProviderId();
    const p = mod.getActiveProvider();

    expect(id).toBe('groq');
    expect((p as any).__mock).toBe('groq');
  });

  it('environment variable overrides config value', async () => {
    vi.resetModules();
    mockProviders();
    mockLoadConfig({ provider: 'openrouter' });

    process.env.GRITCH_PROVIDER = 'groq';
    const mod = await import('../../src/core/ai/provider.registry');

    const id = mod.getActiveProviderId();
    const p = mod.getActiveProvider();

    expect(id).toBe('groq');
    expect((p as any).__mock).toBe('groq');
  });

  it('unsupported env value emits expected warning exactly once', async () => {
    vi.resetModules();
    mockProviders();
    mockLoadConfig({ provider: 'openrouter' });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    process.env.GRITCH_PROVIDER = 'not-a-real-provider';
    const mod = await import('../../src/core/ai/provider.registry');

    // warning should occur within getActiveProviderId() only when it sees an unsupported value.
    mod.getActiveProviderId();
    mod.getActiveProvider();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      `WARNING: Unsupported GRITCH_PROVIDER="not-a-real-provider"; falling back to "groq".`
    );
  });

  it('getActiveProvider() returns provider corresponding to getActiveProviderId()', async () => {
    vi.resetModules();
    mockProviders();
    mockLoadConfig({ provider: 'openrouter' });

    process.env.GRITCH_PROVIDER = 'openrouter';
    const mod = await import('../../src/core/ai/provider.registry');

    const id = mod.getActiveProviderId();
    const provider = mod.getActiveProvider();

    expect((provider as any).__mock).toBe(id);
  });
});

