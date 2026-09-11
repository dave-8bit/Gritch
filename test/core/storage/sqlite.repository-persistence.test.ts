import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { inspectRepository } from '../../../src/inspect/profile';
import { resolveRepositoryIdentity } from '../../../src/core/repository/repository.identity';
import {
  InvalidRepositoryCacheError,
  RepositoryPersistenceError,
} from '../../../src/core/repository/repository.persistence';
import { CURRENT_SERIALIZATION_VERSION, type RepositorySnapshot } from '../../../src/core/repository/repository.snapshot';
import { CURRENT_INSPECTION_VERSION } from '../../../src/core/repository/repository.state';
import { openRepositoryDatabase } from '../../../src/core/storage/sqlite.connection';
import { migrateRepositoryDatabase } from '../../../src/core/storage/sqlite.migrations';
import { SqliteRepositoryPersistence } from '../../../src/core/storage/sqlite.repository-persistence';
import { clearDependencyCache } from '../../../src/inspect/dependencies';

const temporaryRoots: string[] = [];

function makeRoot(label: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `gritch-persistence-${label}-`));
  temporaryRoots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    dependencies: { [`package-${label}`]: '1.0.0' },
  }));
  return root;
}

function makeSnapshot(root: string, sourceRevision = 'a'.repeat(40)): RepositorySnapshot {
  return {
    identity: resolveRepositoryIdentity(root),
    sourceRevision,
    repositoryState: {
      headRevision: sourceRevision,
      worktreeState: 'clean',
      statusFingerprint: 'clean-fingerprint',
      inspectionVersion: CURRENT_INSPECTION_VERSION,
    },
    capturedAt: '2026-09-03T12:00:00.000Z',
    serializationVersion: CURRENT_SERIALIZATION_VERSION,
    profile: inspectRepository(root),
  };
}

function readRow(root: string): Record<string, unknown> | undefined {
  const database = openRepositoryDatabase(root);
  const row = database.prepare('SELECT * FROM repository_snapshots').get() as Record<string, unknown> | undefined;
  database.close();
  return row;
}

afterEach(() => {
  clearDependencyCache();
  while (temporaryRoots.length > 0) {
    fs.rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

describe('SqliteRepositoryPersistence', () => {
  it('returns undefined for a missing snapshot and uses the repository database', () => {
    const root = makeRoot('missing');
    const identity = resolveRepositoryIdentity(root);
    const persistence = new SqliteRepositoryPersistence();

    expect(persistence.load(identity)).toBeUndefined();
    expect(fs.existsSync(path.join(root, '.gritch', 'repository.sqlite'))).toBe(true);
  });

  it('saves and loads a snapshot with all database fields and Set reconstruction', () => {
    const root = makeRoot('save');
    const snapshot = makeSnapshot(root);
    const persistence = new SqliteRepositoryPersistence();

    persistence.save(snapshot);
    const loaded = persistence.load(snapshot.identity);
    const row = readRow(root);

    expect(loaded).toEqual(snapshot);
    expect(loaded?.profile.dependencies.all).toBeInstanceOf(Set);
    expect(row).toMatchObject({
      repository_key: snapshot.identity.key,
      root_path: snapshot.identity.root,
      source_revision: snapshot.sourceRevision,
      serialization_version: CURRENT_SERIALIZATION_VERSION,
      captured_at: snapshot.capturedAt,
    });
    expect(typeof row?.profile_json).toBe('string');
  });

  it('replaces an existing snapshot atomically', () => {
    const root = makeRoot('replace');
    const first = makeSnapshot(root, 'a'.repeat(40));
    const second = makeSnapshot(root, 'b'.repeat(40));
    const persistence = new SqliteRepositoryPersistence();

    persistence.save(first);
    persistence.save(second);

    expect(persistence.load(first.identity)?.sourceRevision).toBe(second.sourceRevision);
  });

  it('preserves the previous snapshot when replacement fails', () => {
    const root = makeRoot('transaction');
    const first = makeSnapshot(root);
    const setup = migrateRepositoryDatabase(root);
    setup.exec(`
      CREATE TRIGGER reject_snapshot_update
      BEFORE UPDATE ON repository_snapshots
      BEGIN SELECT RAISE(ABORT, 'replacement rejected'); END
    `);
    setup.close();

    const persistence = new SqliteRepositoryPersistence();
    persistence.save(first);
    expect(() => persistence.save(makeSnapshot(root, 'b'.repeat(40)))).toThrow(RepositoryPersistenceError);
    expect(persistence.load(first.identity)?.sourceRevision).toBe(first.sourceRevision);
  });

  it('does not modify the stored snapshot when serialization fails', () => {
    const root = makeRoot('serialization');
    const first = makeSnapshot(root);
    const invalid = { ...first, serializationVersion: CURRENT_SERIALIZATION_VERSION + 1 };
    const persistence = new SqliteRepositoryPersistence();
    persistence.save(first);

    expect(() => persistence.save(invalid)).toThrow(InvalidRepositoryCacheError);
    expect(persistence.load(first.identity)?.sourceRevision).toBe(first.sourceRevision);
  });

  it('rejects corrupt, unsupported, and malformed rows as invalid cache', () => {
    const root = makeRoot('invalid');
    const snapshot = makeSnapshot(root);
    const persistence = new SqliteRepositoryPersistence();
    persistence.save(snapshot);

    const database = openRepositoryDatabase(root);
    database.prepare('UPDATE repository_snapshots SET profile_json = ?').run('{not-json');
    database.close();
    expect(() => persistence.load(snapshot.identity)).toThrow(InvalidRepositoryCacheError);

    persistence.save(snapshot);
    const future = openRepositoryDatabase(root);
    future.prepare('UPDATE repository_snapshots SET serialization_version = ?').run(CURRENT_SERIALIZATION_VERSION + 1);
    future.close();
    expect(() => persistence.load(snapshot.identity)).toThrow(InvalidRepositoryCacheError);
  });

  it('rejects invalid database row fields', () => {
    const root = makeRoot('row');
    const snapshot = makeSnapshot(root);
    const persistence = new SqliteRepositoryPersistence();
    persistence.save(snapshot);
    const database = openRepositoryDatabase(root);

    database.prepare('UPDATE repository_snapshots SET serialization_version = ?').run('invalid');
    database.close();
    expect(() => persistence.load(snapshot.identity)).toThrow(InvalidRepositoryCacheError);
  });

  it('clears only the selected repository snapshot and safely clears missing rows', () => {
    const firstRoot = makeRoot('first');
    const secondRoot = makeRoot('second');
    const first = makeSnapshot(firstRoot);
    const second = makeSnapshot(secondRoot);
    const persistence = new SqliteRepositoryPersistence();
    persistence.save(first);
    persistence.save(second);

    persistence.clear(first.identity);
    persistence.clear(first.identity);

    expect(persistence.load(first.identity)).toBeUndefined();
    expect(persistence.load(second.identity)).toEqual(second);
  });

  it('keeps separate repository databases and snapshots isolated', () => {
    const firstRoot = makeRoot('isolated-a');
    const secondRoot = makeRoot('isolated-b');
    const first = makeSnapshot(firstRoot);
    const second = makeSnapshot(secondRoot);
    const persistence = new SqliteRepositoryPersistence();
    persistence.save(first);
    persistence.save(second);

    expect(persistence.load(first.identity)?.identity).toEqual(first.identity);
    expect(persistence.load(second.identity)?.identity).toEqual(second.identity);
    expect(path.join(firstRoot, '.gritch', 'repository.sqlite')).not.toBe(path.join(secondRoot, '.gritch', 'repository.sqlite'));
  });

  it('wraps database failures as persistence failures', () => {
    const root = makeRoot('failure');
    fs.writeFileSync(path.join(root, '.gritch'), 'not a directory');
    const persistence = new SqliteRepositoryPersistence();

    expect(() => persistence.load(resolveRepositoryIdentity(root))).toThrow(RepositoryPersistenceError);
  });
});
