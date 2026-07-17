import { normalizeToPosix } from './fs';

export interface IgnoreRules {
  /** Directory names to ignore anywhere in the tree */
  dirNames: Set<string>;
  /** File names to ignore anywhere in the tree */
  fileNames: Set<string>;
}

const DEFAULT_DIR_NAMES = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  'vendor',
  'target',
  'out',
  '.vercel',
  '.serverless',
];

const DEFAULT_FILE_NAMES: string[] = [];


export const defaultIgnoreRules: IgnoreRules = {
  dirNames: new Set(DEFAULT_DIR_NAMES),
  fileNames: new Set(DEFAULT_FILE_NAMES),
};

export function shouldIgnoreDir(dirName: string, rules: IgnoreRules = defaultIgnoreRules): boolean {
  return rules.dirNames.has(dirName);
}

export function shouldIgnoreFile(fileName: string, rules: IgnoreRules = defaultIgnoreRules): boolean {
  return rules.fileNames.has(fileName);
}

/**
 * Ignores by path heuristics for safety.
 *
 * - Always ignore when any path segment matches ignored dir names
 * - Optionally ignore whole subtrees
 */
export function shouldIgnorePath(relativePosixPath: string, rules: IgnoreRules = defaultIgnoreRules): boolean {
  const p = normalizeToPosix(relativePosixPath);
  const segments = p.split('/').filter(Boolean);
  return segments.some((seg) => rules.dirNames.has(seg));
}

