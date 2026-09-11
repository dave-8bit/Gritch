import type { RepositoryIdentity } from './repository.identity';

export const CURRENT_FILE_METADATA_VERSION = 1;

export interface RepositoryFileRecord {
  repositoryKey: string;
  relativePath: string;
  sizeBytes: number;
  modifiedTime: number;
  extension: string;
  metadataVersion: number;
}

export interface RepositoryFileIndexPersistence {
  load(identity: RepositoryIdentity): RepositoryFileRecord[];
  replace(identity: RepositoryIdentity, records: readonly RepositoryFileRecord[]): void;
}

export interface RepositoryFileIndexReader {
  findByPath(identity: RepositoryIdentity, relativePath: string): RepositoryFileRecord | undefined;
  findByPrefix(identity: RepositoryIdentity, prefix: string): RepositoryFileRecord[];
  findByExtension(identity: RepositoryIdentity, extension: string): RepositoryFileRecord[];
  searchPaths(identity: RepositoryIdentity, query: string): RepositoryFileRecord[];
}

export function normalizeRepositoryPath(value: string): string {
  return value
    .replace(/[\\/]+/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')
    .join('/');
}

export function createRepositoryFileRecord(
  identity: RepositoryIdentity,
  relativePath: string,
  sizeBytes: number,
  modifiedTime: number,
): RepositoryFileRecord {
  const normalizedPath = normalizeRepositoryPath(relativePath);
  const extension = normalizedPath.includes('.')
    ? normalizedPath.slice(normalizedPath.lastIndexOf('.')).toLowerCase()
    : '';

  return {
    repositoryKey: identity.key,
    relativePath: normalizedPath,
    sizeBytes,
    modifiedTime: Math.trunc(modifiedTime),
    extension,
    metadataVersion: CURRENT_FILE_METADATA_VERSION,
  };
}
