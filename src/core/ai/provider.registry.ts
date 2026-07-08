import type { AIProvider } from './ai.provider';
import { GroqProvider } from '../../providers/groq/groq.provider';

export type ProviderId = 'groq';

const defaultProviderId: ProviderId = 'groq';

// Preserve existing runtime behavior by instantiating the default provider at module load time.
const providers: Record<ProviderId, AIProvider> = {
  groq: new GroqProvider(),
};

export function getActiveProviderId(): ProviderId {
  // Provider selection is intentionally minimal for production-quality behavior preservation.
  // When no provider is specified, default to Groq.
  // Future: read from config/env and support additional provider IDs.
  return defaultProviderId;
}

export function getActiveProvider(): AIProvider {
  const id = getActiveProviderId();
  return providers[id] ?? providers[defaultProviderId];
}

