import { formatDoctor } from '../inspect/formatter';
import type { RepositoryMemory } from '../core/repository/repository.memory';
import { repositoryMemory } from './repository-memory';

export async function doctorCommand(
  rootPath?: string,
  memory: RepositoryMemory = repositoryMemory,
): Promise<void> {
  const snapshot = await memory.getSnapshot(rootPath);
  console.log(formatDoctor(snapshot.profile));
}
