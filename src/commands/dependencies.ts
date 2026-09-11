import { formatDependencies } from '../inspect/formatter';
import type { RepositoryMemory } from '../core/repository/repository.memory';
import { repositoryMemory } from './repository-memory';

export async function dependenciesCommand(
  rootPath?: string,
  memory: RepositoryMemory = repositoryMemory,
): Promise<void> {
  const snapshot = await memory.getSnapshot(rootPath);
  console.log(formatDependencies(snapshot.profile.dependencies, snapshot.profile.packageManager));
}