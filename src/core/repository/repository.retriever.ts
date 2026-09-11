import type { RepositoryIdentity } from './repository.identity';
import { resolveRepositoryIdentity } from './repository.identity';
import type {
  RepositoryFileIndexReader,
  RepositoryFileRecord,
} from './repository.file-index';
import { normalizeRepositoryPath } from './repository.file-index';
import { SqliteRepositoryFileIndexPersistence } from '../storage/sqlite.repository-file-index';

export interface RepositoryRetrieverDependencies {
  reader: RepositoryFileIndexReader;
  resolveIdentity: (repositoryPath?: string) => RepositoryIdentity;
}

export type RepositoryRetrieverOptions = Partial<RepositoryRetrieverDependencies>;

function normalizeExtension(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized && normalized.startsWith('.') ? normalized : `.${normalized}`;
}

export class RepositoryRetriever {
  private readonly dependencies: RepositoryRetrieverDependencies;

  constructor(options: RepositoryRetrieverOptions = {}) {
    this.dependencies = {
      reader: options.reader ?? new SqliteRepositoryFileIndexPersistence(),
      resolveIdentity: options.resolveIdentity ?? resolveRepositoryIdentity,
    };
  }

  findByPath(repositoryPath: string | undefined, relativePath: string): RepositoryFileRecord | undefined {
    const identity = this.dependencies.resolveIdentity(repositoryPath);
    const target = normalizeRepositoryPath(relativePath);
    return this.dependencies.reader.findByPath(identity, target);
  }

  findByPrefix(repositoryPath: string | undefined, prefix: string): RepositoryFileRecord[] {
    const identity = this.dependencies.resolveIdentity(repositoryPath);
    const target = normalizeRepositoryPath(prefix);
    return this.dependencies.reader.findByPrefix(identity, target);
  }

  findByExtension(repositoryPath: string | undefined, extension: string): RepositoryFileRecord[] {
    const identity = this.dependencies.resolveIdentity(repositoryPath);
    const target = normalizeExtension(extension);
    return this.dependencies.reader.findByExtension(identity, target);
  }

  searchPaths(repositoryPath: string | undefined, query: string): RepositoryFileRecord[] {
    const identity = this.dependencies.resolveIdentity(repositoryPath);
    const target = normalizeRepositoryPath(query).toLowerCase();
    return this.dependencies.reader.searchPaths(identity, target);
  }
}
