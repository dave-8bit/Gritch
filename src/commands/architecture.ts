import { formatArchitecture } from '../inspect/formatter';
import type { RepositoryMemory } from '../core/repository/repository.memory';
import { repositoryMemory } from './repository-memory';

export async function architectureCommand(
  rootPath?: string,
  memory: RepositoryMemory = repositoryMemory,
): Promise<void> {
  const snapshot = await memory.getSnapshot(rootPath);
  console.log(formatArchitecture(snapshot.profile.architecture));
}