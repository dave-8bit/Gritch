import fs from 'fs';
import path from 'path';
import { shouldIgnoreDir, shouldIgnorePath, defaultIgnoreRules, type IgnoreRules } from './ignore';

export interface WalkOptions {
  root: string;
  /** Maximum depth relative to root (0 = only root itself) */
  maxDepth?: number;
  /** Maximum number of files to yield */
  maxFiles?: number;
  /** Follow symlinks? Default: false */
  followSymlinks?: boolean;
  /** Ignore rules */
  ignore?: IgnoreRules;
}

export interface WalkEntry {
  fullPath: string;
  relativePath: string;
  stat: fs.Stats;
}

/**
 * Safe recursive walk that avoids common directories.
 * Yields both files and stats; does not read file contents.
 */
export function* walkFiles(options: WalkOptions): Generator<WalkEntry, void, void> {
  const {
    root,
    maxDepth = 20,
    maxFiles = 10_000,
    followSymlinks = false,
    ignore = defaultIgnoreRules,
  } = options;

  const rootAbs = path.resolve(root);
  let count = 0;
  const seenDirs = new Set<string>();

  function* walkDir(dir: string, depth: number): Generator<WalkEntry> {
    if (count >= maxFiles) return;
    if (depth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (count >= maxFiles) return;

      const full = path.join(dir, entry.name);
      const rel = path.relative(rootAbs, full);

      // Ignore by path segments
      if (shouldIgnorePath(rel, ignore)) continue;

      if (entry.isDirectory()) {
        if (!followSymlinks && entry.isSymbolicLink && entry.isSymbolicLink()) {
          continue;
        }

        if (shouldIgnoreDir(entry.name, ignore)) continue;

        // Symlink/cycle guard
        if (followSymlinks) {
          try {
            const real = fs.realpathSync(full);
            if (seenDirs.has(real)) continue;
            seenDirs.add(real);
          } catch {
            // ignore realpath errors
          }
        }

        yield* walkDir(full, depth + 1);
        continue;
      }

      if (entry.isFile()) {
        let stat: fs.Stats;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }

        count++;
        yield { fullPath: full, relativePath: rel, stat };
      }
    }
  }

  yield* walkDir(rootAbs, 0);
}

