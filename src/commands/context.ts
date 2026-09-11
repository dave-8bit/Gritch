import { buildRepositoryContext } from '../ai/profile-context';
import type { RepositoryMemory } from '../core/repository/repository.memory';
import { repositoryMemory } from './repository-memory';

export async function contextCommand(
  rootPath?: string,
  memory: RepositoryMemory = repositoryMemory,
): Promise<void> {
  const snapshot = await memory.getSnapshot(rootPath);
  console.log(buildRepositoryContext(snapshot.profile));
}