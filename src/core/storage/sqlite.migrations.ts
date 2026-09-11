import type Database from 'better-sqlite3';

import { openRepositoryDatabase } from './sqlite.connection';

export const CURRENT_SCHEMA_VERSION = 2;

const SCHEMA_VERSION_KEY = 'schema_version';

const CREATE_SCHEMA_META = `
  CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  )
`;

const CREATE_REPOSITORY_SNAPSHOTS = `
  CREATE TABLE repository_snapshots (
    repository_key TEXT PRIMARY KEY NOT NULL,
    root_path TEXT NOT NULL,
    source_revision TEXT,
    serialization_version INTEGER NOT NULL,
    profile_json TEXT NOT NULL,
    captured_at TEXT NOT NULL
  )
`;

const CREATE_REPOSITORY_FILES = `
  CREATE TABLE repository_files (
    repository_key TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    modified_time INTEGER NOT NULL,
    extension TEXT NOT NULL,
    metadata_version INTEGER NOT NULL,
    PRIMARY KEY (repository_key, relative_path)
  )
`;

const CREATE_REPOSITORY_FILES_EXTENSION_INDEX = `
  CREATE INDEX repository_files_extension
  ON repository_files (repository_key, extension)
`;


function readSchemaVersion(database: Database.Database): number {
  const row = database
    .prepare('SELECT value FROM schema_meta WHERE key = ?')
    .get(SCHEMA_VERSION_KEY) as { value?: string } | undefined;

  if (!row) return 0;

  const version = Number(row.value);
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`Invalid SQLite schema version: ${row.value}`);
  }

  return version;
}

function recordSchemaVersion(database: Database.Database, version: number): void {
  database
    .prepare(`
      INSERT INTO schema_meta (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
    .run(SCHEMA_VERSION_KEY, String(version));
}

function applyVersionOne(database: Database.Database): void {
  database.exec(CREATE_REPOSITORY_SNAPSHOTS);
}

function applyVersionTwo(database: Database.Database): void {
  database.exec(CREATE_REPOSITORY_FILES);
  database.exec(CREATE_REPOSITORY_FILES_EXTENSION_INDEX);
}

/** Opens and migrates a repository database to the current schema version. */
export function migrateRepositoryDatabase(repositoryRoot: string): Database.Database {
  const database = openRepositoryDatabase(repositoryRoot);

  try {
    const migrate = database.transaction(() => {
      database.exec(CREATE_SCHEMA_META);
      const currentVersion = readSchemaVersion(database);

      if (currentVersion > CURRENT_SCHEMA_VERSION) {
        throw new Error(
          `Unsupported SQLite schema version ${currentVersion}; `
          + `maximum supported version is ${CURRENT_SCHEMA_VERSION}`,
        );
      }

      if (currentVersion < 1) {
        applyVersionOne(database);
        recordSchemaVersion(database, 1);
      }
      if (currentVersion < 2) {
        applyVersionTwo(database);
        recordSchemaVersion(database, 2);
      }
    });

    migrate();
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}