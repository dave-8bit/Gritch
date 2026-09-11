import { buildFileInventory } from '../../inspect/inventory';
import { resolveRepositoryIdentity, type RepositoryIdentity } from './repository.identity';
import {
  createRepositoryFileRecord,
  type RepositoryFileIndexPersistence,
  type RepositoryFileRecord,
} from './repository.file-index';
import { SqliteRepositoryFileIndexPersistence } from '../storage/sqlite.repository-file-index';

export interface RepositoryIndexerDependencies {
  persistence: RepositoryFileIndexPersistence;
  resolveIdentity: (repositoryPath?: string) => RepositoryIdentity;
  inventory: typeof buildFileInventory;
}

export type RepositoryIndexerOptions = Partial<RepositoryIndexerDependencies>;

function sameRecord(left: RepositoryFileRecord, right: RepositoryFileRecord): boolean {
  return left.repositoryKey === right.repositoryKey &&
    left.relativePath === right.relativePath &&
    left.sizeBytes === right.sizeBytes &&
    left.modifiedTime === right.modifiedTime &&
    left.extension === right.extension &&
    left.metadataVersion === right.metadataVersion;
}

export class RepositoryIndexer {
  private readonly dependencies: RepositoryIndexerDependencies;

  constructor(options: RepositoryIndexerOptions = {}) {
    this.dependencies = {
      persistence: options.persistence ?? new SqliteRepositoryFileIndexPersistence(),
      resolveIdentity: options.resolveIdentity ?? resolveRepositoryIdentity,
      inventory: options.inventory ?? buildFileInventory,
    };
  }

  refresh(repositoryPath?: string): RepositoryFileRecord[] {
    const identity = this.dependencies.resolveIdentity(repositoryPath);
    const inventory = this.dependencies.inventory({ rootPath: identity.root });
    const currentRecords = inventory.files
      .map((file) => createRepositoryFileRecord(
        identity,
        file.relativePath ?? file.path,
        file.size ?? 0,
        file.modifiedTime ?? 0,
      ))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

    const persistedByPath = new Map(
      this.dependencies.persistence.load(identity)
        .map((record) => [record.relativePath, record]),
    );
    const records = currentRecords.map((record) => {
      const persisted = persistedByPath.get(record.relativePath);
      return persisted && sameRecord(persisted, record) ? persisted : record;
    });

    this.dependencies.persistence.replace(identity, records);
    return records;
  }
}
