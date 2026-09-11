import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildRepositoryContext } from '../../../src/ai/profile-context';
import { inspectRepository } from '../../../src/inspect/profile';
import { resolveRepositoryIdentity } from '../../../src/core/repository/repository.identity';
import {
  CURRENT_SERIALIZATION_VERSION,
  deserializeRepositorySnapshot,
  serializeRepositorySnapshot,
  type RepositorySnapshot,
} from '../../../src/core/repository/repository.snapshot';
import { CURRENT_INSPECTION_VERSION } from '../../../src/core/repository/repository.state';
import { clearDependencyCache } from '../../../src/inspect/dependencies';

const temporaryRoots: string[] = [];

function makeSnapshot(): RepositorySnapshot {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-snapshot-'));
  temporaryRoots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    dependencies: { react: '^18.0.0' },
    devDependencies: { vitest: '^4.0.0' },
    scripts: { test: 'vitest' },
    packageManager: 'npm@10.0.0',
  }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'main.tsx'), 'export {};');

  const identity = resolveRepositoryIdentity(root);
  return {
    identity,
    sourceRevision: 'a'.repeat(40),
    repositoryState: {
      headRevision: 'a'.repeat(40),
      worktreeState: 'clean',
      statusFingerprint: 'clean-fingerprint',
      inspectionVersion: CURRENT_INSPECTION_VERSION,
    },
    capturedAt: '2026-09-03T12:00:00.000Z',
    serializationVersion: CURRENT_SERIALIZATION_VERSION,
    profile: inspectRepository(root),
  };
}

afterEach(() => {
  clearDependencyCache();
  while (temporaryRoots.length > 0) {
    fs.rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

describe('repository snapshot serialization', () => {
  it('round-trips a complete repository profile and reconstructs dependencies.all as a Set', () => {
    const original = makeSnapshot();
    const restored = deserializeRepositorySnapshot(serializeRepositorySnapshot(original));

    expect(restored.identity).toEqual(original.identity);
    expect(restored.sourceRevision).toBe(original.sourceRevision);
    expect(restored.repositoryState).toEqual(original.repositoryState);
    expect(restored.capturedAt).toBe(original.capturedAt);
    expect(restored.serializationVersion).toBe(CURRENT_SERIALIZATION_VERSION);
    expect(restored.profile.root).toBe(original.profile.root);
    expect(restored.profile.inventory).toEqual(original.profile.inventory);
    expect(restored.profile.languages).toEqual(original.profile.languages);
    expect(restored.profile.frameworks).toEqual(original.profile.frameworks);
    expect(restored.profile.architecture).toEqual(original.profile.architecture);
    expect(restored.profile.health).toEqual(original.profile.health);
    expect(restored.profile.dependencies.all).toBeInstanceOf(Set);
    expect(Array.from(restored.profile.dependencies.all)).toEqual(
      Array.from(original.profile.dependencies.all),
    );
  });

  it('keeps deserialized profiles compatible with the existing context formatter', () => {
    const original = makeSnapshot();
    const restored = deserializeRepositorySnapshot(serializeRepositorySnapshot(original));

    expect(buildRepositoryContext(restored.profile)).toBe(buildRepositoryContext(original.profile));
  });

  it('does not mutate the original runtime profile during serialization', () => {
    const original = makeSnapshot();
    const before = Array.from(original.profile.dependencies.all);

    serializeRepositorySnapshot(original);

    expect(original.profile.dependencies.all).toBeInstanceOf(Set);
    expect(Array.from(original.profile.dependencies.all)).toEqual(before);
  });

  it('rejects invalid JSON and invalid snapshot structure', () => {
    expect(() => deserializeRepositorySnapshot('{not json')).toThrow('Invalid repository snapshot JSON');
    expect(() => deserializeRepositorySnapshot(JSON.stringify({}))).toThrow(
      'Invalid or incompatible repository snapshot',
    );
  });

  it('rejects missing profile sections and wrong primitive types', () => {
    const parsed = JSON.parse(serializeRepositorySnapshot(makeSnapshot())) as Record<string, any>;
    delete parsed.profile.health;
    expect(() => deserializeRepositorySnapshot(JSON.stringify(parsed))).toThrow();

    const wrongType = JSON.parse(serializeRepositorySnapshot(makeSnapshot())) as Record<string, any>;
    wrongType.profile.inventory.fileCount = 'many';
    expect(() => deserializeRepositorySnapshot(JSON.stringify(wrongType))).toThrow();
  });

  it('rejects invalid dependency and nested detector structures', () => {
    const dependencyError = JSON.parse(serializeRepositorySnapshot(makeSnapshot())) as Record<string, any>;
    dependencyError.profile.dependencies.all = 'not-an-array';
    expect(() => deserializeRepositorySnapshot(JSON.stringify(dependencyError))).toThrow();

    const detectorError = JSON.parse(serializeRepositorySnapshot(makeSnapshot())) as Record<string, any>;
    detectorError.profile.languages.evidence = [42];
    expect(() => deserializeRepositorySnapshot(JSON.stringify(detectorError))).toThrow();
  });

  it('rejects unsupported serialization versions and invalid snapshot metadata', () => {
    const future = JSON.parse(serializeRepositorySnapshot(makeSnapshot())) as Record<string, any>;
    future.serializationVersion = CURRENT_SERIALIZATION_VERSION + 1;
    expect(() => deserializeRepositorySnapshot(JSON.stringify(future))).toThrow();

    const invalidIdentity = JSON.parse(serializeRepositorySnapshot(makeSnapshot())) as Record<string, any>;
    invalidIdentity.identity.key = '/different/root';
    expect(() => deserializeRepositorySnapshot(JSON.stringify(invalidIdentity))).toThrow();

    const invalidTimestamp = JSON.parse(serializeRepositorySnapshot(makeSnapshot())) as Record<string, any>;
    invalidTimestamp.capturedAt = 'not-a-date';
    expect(() => deserializeRepositorySnapshot(JSON.stringify(invalidTimestamp))).toThrow();
  });

  it('persists only the explicit structured snapshot representation', () => {
    const snapshot = makeSnapshot();
    const serialized = serializeRepositorySnapshot(snapshot);
    const parsed = JSON.parse(serialized);

    expect(parsed.profile.dependencies.all).toEqual(expect.any(Array));
    expect(serialized).not.toContain('API_KEY');
    expect(serialized).not.toContain('systemPrompt');
    expect(serialized).not.toContain('userPrompt');
    expect(serialized).not.toContain('repository.sqlite');
    expect(serialized).not.toContain('export {};');
  });
});