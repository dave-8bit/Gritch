import path from 'path';

import type { InventoryResult, HealthAssetId, RepositoryHealthResult } from './types';
import { buildFileInventory } from './inventory';
import { normalizeToPosix } from './fs';

// ---------------------------------------------------------------------------
// Asset definition
// ---------------------------------------------------------------------------

interface AssetRule {
  id: HealthAssetId;
  /** One or more POSIX relative paths that constitute this asset. */
  paths: string[];
  /** If true, treat the path as a directory prefix match rather than exact file. */
  isDirectory: boolean;
}

const ASSET_RULES: AssetRule[] = [
  { id: 'README',              paths: ['README.md', 'README', 'README.rst', 'README.txt'],   isDirectory: false },
  { id: 'LICENSE',             paths: ['LICENSE', 'LICENSE.txt', 'LICENSE.md'],              isDirectory: false },
  { id: 'CHANGELOG',           paths: ['CHANGELOG.md', 'CHANGELOG', 'CHANGELOG.txt'],        isDirectory: false },
  { id: 'CONTRIBUTING',        paths: ['CONTRIBUTING.md', 'CONTRIBUTING'],                   isDirectory: false },
  { id: 'CODE_OF_CONDUCT',     paths: ['CODE_OF_CONDUCT.md', 'CODE_OF_CONDUCT'],             isDirectory: false },
  { id: 'SECURITY',            paths: ['SECURITY.md', 'SECURITY'],                           isDirectory: false },
  { id: 'Dockerfile',          paths: ['Dockerfile', 'docker/Dockerfile'],                   isDirectory: false },
  { id: 'docker-compose.yml',  paths: ['docker-compose.yml', 'docker-compose.yaml', 'docker/docker-compose.yml'], isDirectory: false },
  { id: '.github/workflows',   paths: ['.github/workflows'],                                 isDirectory: true },
  { id: '.editorconfig',       paths: ['.editorconfig'],                                     isDirectory: false },
  { id: '.env.example',        paths: ['.env.example', '.env.sample'],                       isDirectory: false },
];

// ---------------------------------------------------------------------------
// Recommendation map — deterministic, one per asset
// ---------------------------------------------------------------------------

const RECOMMENDATION_MAP: Record<HealthAssetId, string> = {
  README:             'Add a README.md to describe the project, its purpose, and how to get started.',
  LICENSE:            'Add a LICENSE file to specify the terms under which the project can be used.',
  CHANGELOG:          'Add a CHANGELOG.md to track version history and notable changes.',
  CONTRIBUTING:       'Add CONTRIBUTING.md to guide contributors on how to participate.',
  CODE_OF_CONDUCT:    'Add CODE_OF_CONDUCT.md to establish community behaviour expectations.',
  SECURITY:           'Add SECURITY.md to explain the project\'s security policy and reporting process.',
  Dockerfile:         'Add a Dockerfile to enable containerised builds and deployments.',
  'docker-compose.yml': 'Add docker-compose.yml to define multi-container orchestration.',
  '.github/workflows':  'Add GitHub Actions workflows in .github/workflows/ for CI/CD automation.',
  '.editorconfig':      'Add .editorconfig to maintain consistent coding styles across editors.',
  '.env.example':       'Add .env.example to document required environment variables.',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPosix(p: string): string {
  return normalizeToPosix(p);
}

function normalizeInventoryPaths(inv: InventoryResult): Set<string> {
  return new Set(inv.files.map((f) => toPosix(f.path)));
}

function assetPresent(rule: AssetRule, invPaths: Set<string>): boolean {
  if (rule.isDirectory) {
    const prefix = toPosix(rule.paths[0]) + '/';
    for (const p of invPaths) {
      if (p === rule.paths[0] || p.startsWith(prefix)) return true;
    }
    return false;
  }
  return rule.paths.some((rp) => invPaths.has(toPosix(rp)));
}

function computeGrade(score: number): RepositoryHealthResult['grade'] {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 50) return 'Fair';
  return 'Poor';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Inspect repository health by checking for the presence of standard project
 * assets.  Uses its own inventory walk when called standalone.
 *
 * Inspection-only.  No confidence algorithm, no source parsing.
 */
export function detectHealth(rootPath?: string): RepositoryHealthResult {
  const resolvedRoot = rootPath ? path.resolve(rootPath) : process.cwd();
  const inv = buildFileInventory({ rootPath: resolvedRoot, maxDepth: 8, maxFiles: 100_000 });
  return detectHealthWithInventory(resolvedRoot, inv);
}

/**
 * Inspect repository health reusing an existing inventory.  This is the
 * preferred entry point when called from `inspectRepository()` to avoid
 * a duplicate file walk.
 *
 * Inspection-only.  No confidence algorithm, no source parsing.
 */
export function detectHealthWithInventory(
  _rootPath: string,
  inv: InventoryResult,
): RepositoryHealthResult {
  const invPaths = normalizeInventoryPaths(inv);
  const total = ASSET_RULES.length;

  const present: HealthAssetId[] = [];
  const missing: HealthAssetId[] = [];
  const evidence: string[] = [];
  const recommendations: string[] = [];

  for (const rule of ASSET_RULES) {
    if (assetPresent(rule, invPaths)) {
      present.push(rule.id);
      evidence.push(`Found: ${rule.id}`);
    } else {
      missing.push(rule.id);
      evidence.push(`Missing: ${rule.id}`);
      recommendations.push(RECOMMENDATION_MAP[rule.id]);
    }
  }

  // Score computed from dynamic collection size; not a hardcoded constant.
  const score = total > 0 ? Math.round((present.length / total) * 100) : 0;
  const grade = computeGrade(score);

  return {
    score,
    grade,
    recommendations,
    evidence,
    present,
    missing,
  };
}

