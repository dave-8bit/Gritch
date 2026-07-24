import { inspectRepository } from '../inspect/profile';
import { buildRepositoryContext } from './profile-context';

/**
 * Inspects the current repository and builds a deterministic plain-text
 * context block suitable for AI prompts.
 *
 * Wraps the two-step pipeline (inspect + format) so callers don't have to
 * duplicate the try/catch guard or the import chain.
 *
 * Returns `undefined` when inspection fails — a silent, non-fatal fallback
 * that preserves the existing behaviour in every command.
 */
export function getRepositoryContext(): string | undefined {
  try {
    const profile = inspectRepository();
    return buildRepositoryContext(profile);
  } catch {
    // Inspection / formatting failure is non-fatal
    return undefined;
  }
}

