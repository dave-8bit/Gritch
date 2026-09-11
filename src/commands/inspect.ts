import { formatRepositoryProfile } from '../inspect/formatter';
import type { RepositoryMemory } from '../core/repository/repository.memory';
import { repositoryMemory } from './repository-memory';

export async function inspectCommand(
  rootPath?: string,
  memory: RepositoryMemory = repositoryMemory,
): Promise<void> {
  const snapshot = await memory.getSnapshot(rootPath);
  const report = formatRepositoryProfile(snapshot.profile);
  // Deterministic stdout only.
  console.log(report);
}
