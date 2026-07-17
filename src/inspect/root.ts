import fs from 'fs';
import path from 'path';

export interface RootResolutionResult {
  root: string;
  /** The file/folder used to determine root */
  evidence?: string;
}

function existsPath(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/**
 * Resolve a repository root.
 * Strategy (simple, no detection logic beyond git):
 * - Walk upward from startPath until a .git directory is found
 * - If none found, fall back to startPath
 */
export function resolveRepoRoot(startPath: string = process.cwd()): RootResolutionResult {
  const resolvedStart = path.resolve(startPath);
  let cur = resolvedStart;

  // If startPath is a file, use its directory
  try {
    if (existsPath(cur) && fs.statSync(cur).isFile()) {
      cur = path.dirname(cur);
    }
  } catch {
    // ignore
  }

  // Walk upward
  while (true) {
    const gitDir = path.join(cur, '.git');
    if (existsPath(gitDir)) {
      return { root: cur, evidence: gitDir };
    }

    const parent = path.dirname(cur);
    if (parent === cur) {
      return { root: resolvedStart };
    }
    cur = parent;
  }
}

