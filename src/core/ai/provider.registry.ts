import type { AIProvider } from './ai.provider';
import { GroqProvider } from '../../providers/groq/groq.provider';
import { OpenRouterProvider } from '../../providers/openrouter/openrouter.provider';

export type ProviderId = 'groq' | 'openrouter';

const defaultProviderId: ProviderId = 'groq';

// Preserve existing runtime behavior by instantiating providers at module load time.
const providers: Record<ProviderId, AIProvider> = {
  groq: new GroqProvider(),
  openrouter: new OpenRouterProvider(),
};

export function getActiveProviderId(): ProviderId {
  // Provider selection order (highest precedence first):
  // 1) process.env.GRITCH_PROVIDER
  // 2) gritch.config.json: config.provider
  // 3) hard-coded default: 'groq'

  const fromEnv = process.env.GRITCH_PROVIDER;
  if (fromEnv === 'groq') return 'groq';
  if (fromEnv === 'openrouter') return 'openrouter';

  if (fromEnv && fromEnv !== 'groq' && fromEnv !== 'openrouter') {
    // Preserve behavior by falling back to 'groq'.
    // Keep this warning lightweight to avoid changing runtime semantics.
    console.warn(
      `WARNING: Unsupported GRITCH_PROVIDER="${fromEnv}"; falling back to "groq".`
    );
  }





  // NOTE: loadConfig() preserves legacy config behavior.
  // If provider is omitted, defaultConfig.provider will be used.
  // This ensures backward compatibility when no provider is specified.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { loadConfig } = require('../config/config.service') as typeof import('../config/config.service');
  const config = loadConfig();
  if (config.provider === 'groq') return 'groq';
  if (config.provider === 'openrouter') return 'openrouter';

  return defaultProviderId;
}

export function getActiveProvider(): AIProvider {
  const id = getActiveProviderId();
  return providers[id] ?? providers[defaultProviderId];
}



