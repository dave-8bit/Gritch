import type { RepositoryProfile } from '../inspect/profile';
import { inspectRepository } from '../inspect/profile';
import { formatRepositoryProfile } from '../inspect/formatter';

export function inspectCommand(rootPath?: string): void {
  const profile: RepositoryProfile = inspectRepository(rootPath);
  const report = formatRepositoryProfile(profile);
  // Deterministic stdout only.
  console.log(report);
}

