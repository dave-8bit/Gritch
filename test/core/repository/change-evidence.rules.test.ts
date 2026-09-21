import { describe, expect, it } from 'vitest';

import type { ChangeFileRecord } from '../../../src/core/repository/change-evidence';
import {
  classifyChangeFile,
  classifyRisk,
  deriveChangeSignals,
  deriveSubsystem,
} from '../../../src/core/repository/change-evidence.rules';
import type { RepositoryStatus } from '../../../src/core/repository/repository.state';

function makeRecord(overrides: Partial<ChangeFileRecord>): ChangeFileRecord {
  return {
    path: 'src/a.ts',
    status: 'modified',
    insertions: 1,
    deletions: 0,
    changes: 1,
    binary: false,
    extension: '.ts',
    category: 'source',
    subsystem: 'src',
    conflicted: false,
    ...overrides,
  };
}

function cleanStatus(overrides: Partial<RepositoryStatus> = {}): RepositoryStatus {
  return {
    staged: [],
    modified: [],
    untracked: [],
    deleted: [],
    renamed: [],
    conflicted: [],
    entries: [],
    fingerprint: 'fp',
    ...overrides,
  };
}

function riskOf(files: readonly ChangeFileRecord[]) {
  return classifyRisk(files, deriveChangeSignals(files, cleanStatus()));
}

describe('classifyChangeFile', () => {
  it('classifies known code extensions as source', () => {
    expect(classifyChangeFile('src/core/repository/repository.indexer.ts')).toBe('source');
    expect(classifyChangeFile('application.py')).toBe('source');
    expect(classifyChangeFile('src/views/Home.vue')).toBe('source');
  });

  it('keeps assets, fonts, and archives as unknown', () => {
    expect(classifyChangeFile('assets/logo.png')).toBe('unknown');
    expect(classifyChangeFile('assets/image.jpg')).toBe('unknown');
    expect(classifyChangeFile('fonts/font.woff2')).toBe('unknown');
    expect(classifyChangeFile('assets/logo.svg')).toBe('unknown');
    expect(classifyChangeFile('bundle.zip')).toBe('unknown');
  });

  it('classifies dependency manifests and lockfiles by basename', () => {
    expect(classifyChangeFile('package.json')).toBe('dependency');
    expect(classifyChangeFile('package-lock.json')).toBe('dependency');
    expect(classifyChangeFile('packages/a/package.json')).toBe('dependency');
  });

  it('prioritizes migration paths over the generic schema rule', () => {
    expect(classifyChangeFile('src/core/storage/migrations/0001_add_files.sql')).toBe('migration');
    expect(classifyChangeFile('prisma/migrations/20240101_init/migration.sql')).toBe('migration');
    expect(classifyChangeFile('src/db/migrations/001_init.sql')).toBe('migration');
    expect(classifyChangeFile('V2__add_users.sql')).toBe('migration');
  });

  it('classifies schema files without swallowing migrations', () => {
    expect(classifyChangeFile('prisma/schema.prisma')).toBe('schema');
    expect(classifyChangeFile('src/db/schema.sql')).toBe('schema');
    expect(classifyChangeFile('schema.sql')).toBe('schema');
  });

  it('classifies database and persistence paths', () => {
    expect(classifyChangeFile('src/db/client.ts')).toBe('database');
    expect(classifyChangeFile('prisma/seed.ts')).toBe('database');
    expect(classifyChangeFile('data/app.db')).toBe('database');
    expect(classifyChangeFile('src/core/storage/sqlite.repository-file-index.ts')).toBe('persistence');
    expect(classifyChangeFile('src/core/repository/repository.persistence.ts')).toBe('persistence');
    expect(classifyChangeFile('storage/store.ts')).toBe('persistence');
  });

  it('classifies CI/CD paths', () => {
    expect(classifyChangeFile('.github/workflows/ci.yml')).toBe('ci');
    expect(classifyChangeFile('.circleci/config.yml')).toBe('ci');
    expect(classifyChangeFile('.gitlab-ci.yml')).toBe('ci');
    expect(classifyChangeFile('Jenkinsfile')).toBe('ci');
  });

  it('classifies CLI paths', () => {
    expect(classifyChangeFile('src/commands/review.ts')).toBe('cli');
    expect(classifyChangeFile('src/index.ts')).toBe('cli');
    expect(classifyChangeFile('cli/main.ts')).toBe('cli');
    expect(classifyChangeFile('src/core/ai/prompts.ts')).toBe('source');
  });

  it('classifies API paths as path-heuristic', () => {
    expect(classifyChangeFile('src/api/routes.ts')).toBe('api');
    expect(classifyChangeFile('openapi.yaml')).toBe('api');
    expect(classifyChangeFile('src/controllers/user.ts')).toBe('api');
    expect(classifyChangeFile('user.dto.ts')).toBe('api');
  });

  it('classifies generated/build output', () => {
    expect(classifyChangeFile('dist/bundle.js')).toBe('generated');
    expect(classifyChangeFile('coverage/lcov.info')).toBe('generated');
    expect(classifyChangeFile('app.min.js')).toBe('generated');
    expect(classifyChangeFile('src/app.js.map')).toBe('generated');
  });

  it('classifies configuration files', () => {
    expect(classifyChangeFile('gritch.config.json')).toBe('config');
    expect(classifyChangeFile('tsconfig.json')).toBe('config');
    expect(classifyChangeFile('vitest.config.ts')).toBe('config');
    expect(classifyChangeFile('.editorconfig')).toBe('config');
    expect(classifyChangeFile('.env.example')).toBe('config');
    expect(classifyChangeFile('src/core/config/config.service.ts')).toBe('config');
  });

  it('classifies test files before source', () => {
    expect(classifyChangeFile('src/foo.test.ts')).toBe('test');
    expect(classifyChangeFile('src/foo.spec.ts')).toBe('test');
    expect(classifyChangeFile('foo_test.py')).toBe('test');
    expect(classifyChangeFile('test/helpers/x.ts')).toBe('test');
  });

  it('classifies documentation', () => {
    expect(classifyChangeFile('README.md')).toBe('documentation');
    expect(classifyChangeFile('docs/guide.md')).toBe('documentation');
    expect(classifyChangeFile('CHANGELOG.md')).toBe('documentation');
  });
});

describe('deriveSubsystem', () => {
  it('groups src/<area>/<subsystem> to three segments', () => {
    expect(deriveSubsystem('src/core/repository/change-evidence.ts')).toBe('src/core/repository');
    expect(deriveSubsystem('src/core/storage/x.ts')).toBe('src/core/storage');
  });

  it('keeps shallow src paths at the src group', () => {
    expect(deriveSubsystem('src/index.ts')).toBe('src');
    expect(deriveSubsystem('src/a.ts')).toBe('src');
  });

  it('groups packages and apps by name', () => {
    expect(deriveSubsystem('packages/ui/button.tsx')).toBe('packages/ui');
    expect(deriveSubsystem('apps/web/foo.ts')).toBe('apps/web');
  });

  it('falls back to the first two segments elsewhere', () => {
    expect(deriveSubsystem('test/core/x.test.ts')).toBe('test/core');
    expect(deriveSubsystem('scripts/build.ts')).toBe('scripts/build.ts');
  });

  it('keeps root-level files as their own grouping', () => {
    expect(deriveSubsystem('Makefile')).toBe('Makefile');
    expect(deriveSubsystem('package.json')).toBe('package.json');
  });
});

describe('deriveChangeSignals', () => {
  it('flags test-only changes', () => {
    const files = [
      makeRecord({ path: 'src/a.test.ts', category: 'test' }),
      makeRecord({ path: 'src/b.spec.ts', category: 'test' }),
    ];
    const signals = deriveChangeSignals(files, cleanStatus());
    expect(signals.testChanges).toBe(true);
    expect(signals.testOnlyChange).toBe(true);
  });

  it('does not flag mixed source+test as test only', () => {
    const signals = deriveChangeSignals([
      makeRecord({ path: 'src/a.test.ts', category: 'test' }),
      makeRecord({ path: 'src/a.ts', category: 'source' }),
    ], cleanStatus());
    expect(signals.testOnlyChange).toBe(false);
  });

  it('reports security-sensitive paths sorted and deterministically', () => {
    const signals = deriveChangeSignals([
      makeRecord({ path: 'src/auth/login.ts', category: 'source' }),
      makeRecord({ path: 'src/security/audit.ts', category: 'source' }),
      makeRecord({ path: '.env.local', category: 'config' }),
      makeRecord({ path: '.env.example', category: 'config' }),
    ], cleanStatus());
    expect(signals.securitySensitivePaths).toEqual([
      '.env.local',
      'src/auth/login.ts',
      'src/security/audit.ts',
    ]);
  });

  it('reports deleted source files but not deleted assets', () => {
    const signals = deriveChangeSignals([
      makeRecord({ path: 'src/old.ts', status: 'deleted', category: 'source' }),
      makeRecord({ path: 'assets/old.png', status: 'deleted', category: 'unknown' }),
    ], cleanStatus());
    expect(signals.deletedSourceFiles).toEqual(['src/old.ts']);
  });

  it('distinguishes package metadata from other dependency files', () => {
    const manifest = deriveChangeSignals(
      [makeRecord({ path: 'package.json', category: 'dependency' })],
      cleanStatus(),
    );
    expect(manifest.dependencyChanges).toBe(true);
    expect(manifest.packageMetadataChanges).toBe(true);

    const lockfile = deriveChangeSignals(
      [makeRecord({ path: 'pnpm-lock.yaml', category: 'dependency' })],
      cleanStatus(),
    );
    expect(lockfile.dependencyChanges).toBe(true);
    expect(lockfile.packageMetadataChanges).toBe(false);
  });

  it('distinguishes staged-only state from genuine unstaged worktree changes', () => {
    const fullyStaged = deriveChangeSignals(
      [makeRecord({ path: 'src/a.ts' })],
      cleanStatus({ entries: [{ path: 'src/a.ts', index: 'M', workingTree: ' ' }] }),
    );
    expect(fullyStaged.unstagedChangesPresent).toBe(false);

    const worktreeDirty = deriveChangeSignals(
      [makeRecord({ path: 'src/a.ts' })],
      cleanStatus({
        entries: [{ path: 'other.ts', index: ' ', workingTree: 'M' }],
        untracked: ['new.txt'],
      }),
    );
    expect(worktreeDirty.unstagedChangesPresent).toBe(true);
  });
});

describe('classifyRisk', () => {
  it('returns trivial for an empty staged change', () => {
    const result = riskOf([]);
    expect(result.tier).toBe('trivial');
    expect(result.tierReasons).toEqual(['no staged changes']);
  });

  it('returns trivial for a small documentation-only change', () => {
    const result = riskOf([makeRecord({ path: 'README.md', category: 'documentation' })]);
    expect(result.tier).toBe('trivial');
    expect(result.tierReasons).toEqual([
      'small change without source, test, or configuration impact',
    ]);
  });

  it('returns moderate for source, test, or configuration changes', () => {
    expect(riskOf([makeRecord({ path: 'src/a.ts', category: 'source' })]).tier).toBe('moderate');
    expect(riskOf([makeRecord({ path: 'src/a.test.ts', category: 'test' })]).tier).toBe('moderate');
    expect(riskOf([makeRecord({ path: 'tsconfig.json', category: 'config' })]).tier).toBe('moderate');
  });

  it('returns high for schema/migration, persistence, dependency, api, cli, and security flags', () => {
    expect(riskOf([makeRecord({ path: 'src/db/schema.sql', category: 'schema' })]).tier).toBe('high');
    expect(riskOf([makeRecord({ path: 'sqlite.db', category: 'database' })]).tier).toBe('high');
    expect(riskOf([makeRecord({ path: 'package.json', category: 'dependency' })]).tier).toBe('high');
    expect(riskOf([makeRecord({ path: 'src/api/routes.ts', category: 'api' })]).tier).toBe('high');
    expect(riskOf([makeRecord({ path: 'src/index.ts', category: 'cli' })]).tier).toBe('high');
    expect(riskOf([makeRecord({ path: 'src/auth/login.ts', category: 'source' })]).tier).toBe('high');
  });

  it('returns high when source files are deleted', () => {
    const result = riskOf([makeRecord({ path: 'src/old.ts', status: 'deleted', category: 'source' })]);
    expect(result.tier).toBe('high');
    expect(result.tierReasons).toContain('source files deleted');
  });

  it('pins the file-count tier boundary at 20 files', () => {
    const many = Array.from({ length: 21 }, (_, i) => makeRecord({ path: `src/f${i}.ts`, category: 'source' }));
    expect(riskOf(many).tier).toBe('high');
    expect(riskOf(many).tierReasons).toContain('more than 20 files changed');

    const twenty = Array.from({ length: 20 }, (_, i) => makeRecord({ path: `src/f${i}.ts`, category: 'source' }));
    expect(riskOf(twenty).tier).toBe('moderate');
  });

  it('pins the line-change tier boundaries', () => {
    expect(riskOf([makeRecord({ path: 'img.png', category: 'unknown', insertions: 1001 })]).tier).toBe('high');
    expect(riskOf([makeRecord({ path: 'img.png', category: 'unknown', insertions: 151 })]).tier).toBe('moderate');
    expect(riskOf([makeRecord({ path: 'img.png', category: 'unknown', insertions: 150 })]).tier).toBe('trivial');
  });

  it('accumulates multiple high reasons', () => {
    const result = riskOf([
      makeRecord({ path: 'src/db/schema.sql', category: 'schema' }),
      makeRecord({ path: 'package.json', category: 'dependency' }),
    ]);
    expect(result.tier).toBe('high');
    expect(result.tierReasons).toContain('schema/migration files changed');
    expect(result.tierReasons).toContain('dependency files changed');
  });
});