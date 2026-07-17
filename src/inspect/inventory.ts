import path from 'path';
import { resolveRepoRoot } from './root';
import { walkFiles, type WalkOptions } from './walker';
import type { InventoryResult } from './types';

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

  const files: { path: string; size?: number }[] = [];
  for (const entry of walkFiles(walkOpts)) {
    files.push({
      path: path.relative(resolvedRoot, entry.fullPath),
      size: entry.stat.size,
    });
  }

  return {
    root: resolvedRoot,
    files,
  };
}

