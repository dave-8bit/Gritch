import type { RepositoryProfile } from '../inspect/profile';

/**
 * Transforms a RepositoryProfile into a deterministic plain-text context
 * block suitable for injection into an AI user prompt.
 *
 * This is a pure formatter.  It does NOT inspect the repository, perform
 * detection, or contain any business logic.
 *
 * Design:
 *  - Plain text only — no Markdown, YAML, or JSON.
 *  - Only non-zero-confidence, non-null, non-"unknown" values are emitted.
 *  - Each line is `Category: value` with consistent spacing.
 *  - Secondary values are appended after the primary, separated by ", ".
 *  - If every detector returned nothing meaningful, the result is an empty string.
 */
export function buildRepositoryContext(profile: RepositoryProfile): string {
  const lines: string[] = [];

  // Languages
  if (profile.languages.confidence > 0 && profile.languages.primary) {
    const parts = [profile.languages.primary];
    if (profile.languages.secondary.length > 0) {
      parts.push(...profile.languages.secondary);
    }
    lines.push(`  Languages: ${parts.join(', ')}`);
  }

  // Frameworks
  if (profile.frameworks.confidence > 0 && profile.frameworks.primary) {
    const parts = [profile.frameworks.primary];
    if (profile.frameworks.secondary.length > 0) {
      parts.push(...profile.frameworks.secondary);
    }
    lines.push(`  Frameworks: ${parts.join(', ')}`);
  }

  // Build Tools
  if (profile.buildTools.confidence > 0 && profile.buildTools.primary) {
    const parts = [profile.buildTools.primary];
    if (profile.buildTools.secondary.length > 0) {
      parts.push(...profile.buildTools.secondary);
    }
    lines.push(`  Build Tools: ${parts.join(', ')}`);
  }

  // Package Manager
  if (
    profile.packageManager.confidence > 0 &&
    profile.packageManager.detected !== 'unknown'
  ) {
    lines.push(`  Package Manager: ${profile.packageManager.detected}`);
  }

  // Testing
  if (profile.testing.confidence > 0 && profile.testing.primary) {
    const parts = [profile.testing.primary];
    if (profile.testing.secondary.length > 0) {
      parts.push(...profile.testing.secondary);
    }
    lines.push(`  Testing: ${parts.join(', ')}`);
  }

  // Linting
  if (profile.linting.confidence > 0 && profile.linting.primary) {
    const parts = [profile.linting.primary];
    if (profile.linting.secondary.length > 0) {
      parts.push(...profile.linting.secondary);
    }
    lines.push(`  Linting: ${parts.join(', ')}`);
  }

  // Formatting
  if (profile.formatting.confidence > 0 && profile.formatting.primary) {
    const parts = [profile.formatting.primary];
    if (profile.formatting.secondary.length > 0) {
      parts.push(...profile.formatting.secondary);
    }
    lines.push(`  Formatting: ${parts.join(', ')}`);
  }

  // Database
  if (profile.database.confidence > 0 && profile.database.primary) {
    const parts = [profile.database.primary];
    if (profile.database.secondary.length > 0) {
      parts.push(...profile.database.secondary);
    }
    lines.push(`  Database: ${parts.join(', ')}`);
  }

  // ORM
  if (profile.orm.confidence > 0 && profile.orm.primary) {
    const parts = [profile.orm.primary];
    if (profile.orm.secondary.length > 0) {
      parts.push(...profile.orm.secondary);
    }
    lines.push(`  ORM: ${parts.join(', ')}`);
  }

  // Architecture (monorepo detection)
  if (profile.architecture.confidence > 0) {
    const label = profile.architecture.monorepo ? 'Monorepo' : 'Standard';
    lines.push(`  Architecture: ${label}`);
  }

  // Health — always shown (deterministic, file-presence based)
  const gradeText = `${profile.health.grade} (${profile.health.score}/100)`;
  lines.push(`  Health: ${gradeText}`);

  return lines.length > 0 ? lines.join('\n') : '';
}

