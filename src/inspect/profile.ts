import path from 'path';

import type { InventoryResult } from './types';
import { resolveRepoRoot } from './root';
import { buildFileInventory } from './inventory';
import { loadDependencies, type DependencyIndex } from './dependencies';
import { detectLanguages, type LanguageDetectionResult } from './language';
import { detectFrameworksWithInventory, type FrameworkDetectionResult } from './framework';
import { detectBuildToolsWithInventory, type BuildToolDetectionResult } from './buildTool';
import { detectPackageManagerWithInventory, type PackageManagerDetectionResult } from './packageManager';
import { detectTestingFrameworksWithInventory, type TestingFrameworkDetectionResult } from './testing';
import { detectLintingWithInventory, type LintingDetectionResult } from './linting';
import { detectFormattingWithInventory, type FormattingDetectionResult } from './linting';
import { detectDatabaseWithInventory, type DatabaseDetectionResult } from './database';
import { detectOrmWithInventory, type OrmDetectionResult } from './database';


export interface InventorySummary {
  /** Number of files discovered by the shared inventory walk. */

  fileCount: number;
  /** Sum of known file sizes in bytes (files with unknown size contribute 0). */
  totalSizeBytes: number;
}





export interface RepositoryProfile {

  /** Resolved repository root (git root when found, else the given path). */
  root: string;
  /** The file/folder used to determine the root (e.g. a .git directory), if any. */
  rootEvidence?: string;
  inventory: InventorySummary;
  languages: LanguageDetectionResult;
  frameworks: FrameworkDetectionResult;
  buildTools: BuildToolDetectionResult;
  packageManager: PackageManagerDetectionResult;
  dependencies: DependencyIndex;
  testing: TestingFrameworkDetectionResult;
  linting: LintingDetectionResult;
  formatting: FormattingDetectionResult;
  database: DatabaseDetectionResult;
  orm: OrmDetectionResult;
}




function summarizeInventory(inv: InventoryResult): InventorySummary {
  let totalSizeBytes = 0;
  for (const f of inv.files) totalSizeBytes += f.size ?? 0;
  return { fileCount: inv.files.length, totalSizeBytes };
}

/**
 * Inspects a repository by composing the existing detectors into one profile.
 *
 * Framework, build tool, and package manager detection share a single file
 * inventory (built with the same parameters their standalone entry points use,
 * so outputs are identical). Language detection is invoked via its standalone
 * entry point because its behavior (manifest hints, inventory caps) differs
 * from its inventory-sharing variant.
 *
 * No new detection logic lives here.
 */
export function inspectRepository(rootPath?: string): RepositoryProfile {
  const startPath = rootPath ? path.resolve(rootPath) : process.cwd();
  const { root, evidence: rootEvidence } = resolveRepoRoot(startPath);

  const inv = buildFileInventory({ rootPath: root, maxDepth: 8, maxFiles: 100_000 });

  return {
    root,
    rootEvidence,
    inventory: summarizeInventory(inv),
    languages: detectLanguages(root),
    frameworks: detectFrameworksWithInventory(root, inv),
    buildTools: detectBuildToolsWithInventory(root, inv),
    packageManager: detectPackageManagerWithInventory(root, inv),
    dependencies: loadDependencies(root),
    testing: detectTestingFrameworksWithInventory(root, inv),
    linting: detectLintingWithInventory(root, inv),
    formatting: detectFormattingWithInventory(root, inv),
    database: detectDatabaseWithInventory(root, inv),
    orm: detectOrmWithInventory(root, inv),
  };

}
