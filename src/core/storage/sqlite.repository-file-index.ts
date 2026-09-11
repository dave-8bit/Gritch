import type Database from 'better-sqlite3';

import type { RepositoryIdentity } from '../repository/repository.identity';
import {
  RepositoryPersistenceError,
} from '../repository/repository.persistence';
import type {
  RepositoryFileIndexPersistence,
  RepositoryFileIndexReader,
  RepositoryFileRecord,
} from '../repository/repository.file-index';
import { migrateRepositoryDatabase } from './sqlite.migrations';

interface RepositoryFileRow {
  repository_key: unknown;
  relative_path: unknown;
  size_bytes: unknown;
  modified_time: unknown;
  extension: unknown;
  metadata_version: unknown;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function toRecord(row: RepositoryFileRow): RepositoryFileRecord {
  if (
    !isString(row.repository_key) ||
    !isString(row.relative_path) ||
    !isInteger(row.size_bytes) ||
    !isInteger(row.modified_time) ||
    !isString(row.extension) ||
    !isInteger(row.metadata_version)
  ) {
    throw new Error('Invalid repository file index database row');
  }

  return {
    repositoryKey: row.repository_key,
    relativePath: row.relative_path,
    sizeBytes: row.size_bytes,
    modifiedTime: row.modified_time,
    extension: row.extension,
    metadataVersion: row.metadata_version,
  };
}

function persistenceFailure(operation: string, error: unknown): RepositoryPersistenceError {
  const message = error instanceof Error ? error.message : String(error);
  return new RepositoryPersistenceError(`Repository file index ${operation} failed: ${message}`);
}

function closeDatabase(database: Database.Database): void {
  if (database.open) database.close();
}

function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, '!$&');
}

export class SqliteRepositoryFileIndexPersistence implements RepositoryFileIndexPersistence, RepositoryFileIndexReader {
  load(identity: RepositoryIdentity): RepositoryFileRecord[] {
    let database: Database.Database;
    try {
      database = migrateRepositoryDatabase(identity.root);
    } catch (error) {
      throw persistenceFailure('load', error);
    }

    try {
      const rows = database.prepare(`
        SELECT repository_key, relative_path, size_bytes,
               modified_time, extension, metadata_version
        FROM repository_files
        WHERE repository_key = ?
        ORDER BY relative_path
      `).all(identity.key) as RepositoryFileRow[];

      return rows.map(toRecord);
    } catch (error) {
      throw persistenceFailure('load', error);
    } finally {
      closeDatabase(database);
    }
  }

  replace(identity: RepositoryIdentity, records: readonly RepositoryFileRecord[]): void {
    let database: Database.Database;
    try {
      database = migrateRepositoryDatabase(identity.root);
    } catch (error) {
      throw persistenceFailure('replace', error);
    }

    try {
      const replace = database.transaction(() => {
        database.prepare('DELETE FROM repository_files WHERE repository_key = ?').run(identity.key);
        const insert = database.prepare(`
          INSERT INTO repository_files (
            repository_key, relative_path, size_bytes,
            modified_time, extension, metadata_version
          ) VALUES (?, ?, ?, ?, ?, ?)
        `);

        for (const record of records) {
          insert.run(
            identity.key,
            record.relativePath,
            record.sizeBytes,
            record.modifiedTime,
            record.extension,
            record.metadataVersion,
          );
        }
      });

      replace();
    } catch (error) {
      throw persistenceFailure('replace', error);
    } finally {
      closeDatabase(database);
    }
  }

  findByPath(identity: RepositoryIdentity, relativePath: string): RepositoryFileRecord | undefined {
      return this.query(identity, `
        SELECT repository_key, relative_path, size_bytes,
               modified_time, extension, metadata_version
        FROM repository_files
        WHERE repository_key = ? AND relative_path = ?
        ORDER BY relative_path
      `, relativePath)[0];
    }

  findByPrefix(identity: RepositoryIdentity, prefix: string): RepositoryFileRecord[] {
      return this.query(identity, `
        SELECT repository_key, relative_path, size_bytes,
               modified_time, extension, metadata_version
        FROM repository_files
        WHERE repository_key = ?
            AND (relative_path = ? OR relative_path LIKE ? ESCAPE '!')
        ORDER BY relative_path
      `, prefix, prefix ? `${escapeLike(prefix)}/%` : '%');
    }

  findByExtension(identity: RepositoryIdentity, extension: string): RepositoryFileRecord[] {
      return this.query(identity, `
        SELECT repository_key, relative_path, size_bytes,
               modified_time, extension, metadata_version
        FROM repository_files
        WHERE repository_key = ? AND extension = ?
        ORDER BY relative_path
      `, extension);
    }

  searchPaths(identity: RepositoryIdentity, query: string): RepositoryFileRecord[] {
      return this.query(identity, `
        SELECT repository_key, relative_path, size_bytes,
               modified_time, extension, metadata_version
        FROM repository_files
          WHERE repository_key = ? AND lower(relative_path) LIKE ? ESCAPE '!'
        ORDER BY relative_path
      `, `%${escapeLike(query.toLowerCase())}%`);
    }

  private query(identity: RepositoryIdentity, sql: string, ...parameters: string[]): RepositoryFileRecord[] {
      let database: Database.Database;
      try {
        database = migrateRepositoryDatabase(identity.root);
      } catch (error) {
        throw persistenceFailure('query', error);
      }

      try {
        const rows = database.prepare(sql).all(identity.key, ...parameters) as RepositoryFileRow[];
        return rows.map(toRecord);
      } catch (error) {
        throw persistenceFailure('query', error);
      } finally {
        closeDatabase(database);
    }
  }
}
