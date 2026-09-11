import path from 'path';
import { resolveRepoRoot } from './root';
import { walkFiles, type WalkOptions } from './walker';
import type { InventoryResult } from './types';
import { normalizeToPosix } from './fs';

export interface InventoryOptions extends Omit<WalkOptions, 'root'> {
  /** If provided, overrides root auto-resolution */
  rootPath?: string;
}

export function buildFileInventory(options: InventoryOptions = {}): InventoryResult {
  const resolvedRoot = options.rootPath
    ? resolveRepoRoot(options.rootPath).root
    : resolveRepoRoot().root;

  const walkOpts: WalkOptions = {
    root: resolvedRoot,
    maxDepth: options.maxDepth,
    maxFiles: options.maxFiles,
    followSymlinks: options.followSymlinks,
    ignore: options.ignore,
  };

  const files: {
    path: string;
    relativePath: string;
    size?: number;
    modifiedTime?: number;
  }[] = [];
  for (const entry of walkFiles(walkOpts)) {
    files.push({
      path: path.relative(resolvedRoot, entry.fullPath),
      relativePath: normalizeToPosix(path.relative(resolvedRoot, entry.fullPath)),
      size: entry.stat.size,
      modifiedTime: entry.stat.mtimeMs,
    });
  }

  files.sort((left, right) => (left.relativePath ?? left.path).localeCompare(right.relativePath ?? right.path));

  return {
    root: resolvedRoot,
    files,
  };
}
