import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openRepositoryDatabase } from '../../../src/core/storage/sqlite.connection';
import {
  CURRENT_SCHEMA_VERSION,
  migrateRepositoryDatabase,
} from '../../../src/core/storage/sqlite.migrations';

const temporaryRoots: string[] = [];

function makeRepositoryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-migrations-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    fs.rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

function getSchemaVersion(database: ReturnType<typeof openRepositoryDatabase>): string {
  const row = database
    .prepare('SELECT value FROM schema_meta WHERE key = ?')
    .get('schema_version') as { value: string };
  return row.value;
}

describe('sqlite migrations', () => {
  it('creates schema version 2 with the approved tables', () => {
    const root = makeRepositoryRoot();
    const database = migrateRepositoryDatabase(root);

    expect(getSchemaVersion(database)).toBe(String(CURRENT_SCHEMA_VERSION));
    expect(database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'",
    ).get()).toBeTruthy();
    expect(database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'repository_snapshots'",
    ).get()).toBeTruthy();
    expect(database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'repository_files'",
    ).get()).toBeTruthy();

    database.close();
  });

  it('creates repository_snapshots with the expected columns and constraints', () => {
    const root = makeRepositoryRoot();
    const database = migrateRepositoryDatabase(root);
    const columns = database.prepare('PRAGMA table_info(repository_snapshots)').all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;

    expect(columns).toEqual([
      { cid: 0, name: 'repository_key', type: 'TEXT', notnull: 1, dflt_value: null, pk: 1 },
      { cid: 1, name: 'root_path', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 2, name: 'source_revision', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      { cid: 3, name: 'serialization_version', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 4, name: 'profile_json', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 5, name: 'captured_at', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
    ]);
    database.close();
  });

  it('creates repository_files with the approved key and metadata columns', () => {
    const root = makeRepositoryRoot();
    const database = migrateRepositoryDatabase(root);
    const columns = database.prepare('PRAGMA table_info(repository_files)').all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;

    expect(columns).toEqual([
      { cid: 0, name: 'repository_key', type: 'TEXT', notnull: 1, dflt_value: null, pk: 1 },
      { cid: 1, name: 'relative_path', type: 'TEXT', notnull: 1, dflt_value: null, pk: 2 },
      { cid: 2, name: 'size_bytes', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 3, name: 'modified_time', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 4, name: 'extension', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 5, name: 'metadata_version', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
    ]);
    database.close();
  });

  it('is safe and idempotent when run twice', () => {
    const root = makeRepositoryRoot();
    const first = migrateRepositoryDatabase(root);
    first.prepare('INSERT INTO repository_snapshots VALUES (?, ?, ?, ?, ?, ?)').run(
      'repo', root, null, 1, '{}', '2026-09-03T00:00:00.000Z',
    );
    first.close();

    const second = migrateRepositoryDatabase(root);
    expect(getSchemaVersion(second)).toBe('2');
    expect(second.prepare('SELECT repository_key FROM repository_snapshots').get()).toEqual({
      repository_key: 'repo',
    });
    second.close();
  });

  it('opens an existing version-2 database without destructive changes', () => {
    const root = makeRepositoryRoot();
    const database = migrateRepositoryDatabase(root);
    database.prepare('INSERT INTO repository_snapshots VALUES (?, ?, ?, ?, ?, ?)').run(
      'repo', root, 'head', 1, '{"root":"repo"}', '2026-09-03T00:00:00.000Z',
    );
    database.close();

    const reopened = migrateRepositoryDatabase(root);
    expect(reopened.prepare('SELECT * FROM repository_snapshots').get()).toMatchObject({
      repository_key: 'repo',
      source_revision: 'head',
    });
    reopened.close();
  });

  it('migrates version 1 databases while preserving snapshots', () => {
    const root = makeRepositoryRoot();
    const database = openRepositoryDatabase(root);
    database.exec(`
      CREATE TABLE schema_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      CREATE TABLE repository_snapshots (
        repository_key TEXT PRIMARY KEY NOT NULL,
        root_path TEXT NOT NULL,
        source_revision TEXT,
        serialization_version INTEGER NOT NULL,
        profile_json TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );
    `);
    database.prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?)').run('schema_version', '1');
    database.prepare('INSERT INTO repository_snapshots VALUES (?, ?, ?, ?, ?, ?)').run(
      'repo', root, null, 1, '{}', '2026-09-03T00:00:00.000Z',
    );
    database.close();

    const migrated = migrateRepositoryDatabase(root);
    expect(getSchemaVersion(migrated)).toBe('2');
    expect(migrated.prepare('SELECT repository_key FROM repository_snapshots').get()).toEqual({
      repository_key: 'repo',
    });
    expect(migrated.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'repository_files'",
    ).get()).toBeTruthy();
    migrated.close();
  });

  it('rejects an unsupported future schema version and closes the database', () => {
    const root = makeRepositoryRoot();
    const database = openRepositoryDatabase(root);
    database.exec('CREATE TABLE schema_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)');
    database.prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?)').run(
      'schema_version', String(CURRENT_SCHEMA_VERSION + 1),
    );
    database.close();

    expect(() => migrateRepositoryDatabase(root)).toThrow(
      'Unsupported SQLite schema version 3; maximum supported version is 2',
    );

    const check = openRepositoryDatabase(root);
    expect(check.open).toBe(true);
    expect(getSchemaVersion(check)).toBe('3');
    check.close();
  });

  it('rolls back schema changes when a migration fails', () => {
    const root = makeRepositoryRoot();
    const database = openRepositoryDatabase(root);
    database.exec('CREATE TABLE repository_snapshots (existing TEXT)');
    database.close();

    expect(() => migrateRepositoryDatabase(root)).toThrow();

    const check = openRepositoryDatabase(root);
    expect(check.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'",
    ).get()).toBeUndefined();
    expect(check.prepare('PRAGMA table_info(repository_snapshots)').all()).toEqual([
      { cid: 0, name: 'existing', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
    ]);
    check.close();
  });

  it('keeps schema state isolated between repository databases', () => {
    const firstRoot = makeRepositoryRoot();
    const secondRoot = makeRepositoryRoot();
    const first = migrateRepositoryDatabase(firstRoot);
    first.prepare('INSERT INTO repository_snapshots VALUES (?, ?, ?, ?, ?, ?)').run(
      'first', firstRoot, null, 1, '{}', '2026-09-03T00:00:00.000Z',
    );
    first.close();

    const second = migrateRepositoryDatabase(secondRoot);
    expect(second.prepare('SELECT * FROM repository_snapshots').all()).toEqual([]);
    expect(getSchemaVersion(second)).toBe('2');
    second.close();
  });
});