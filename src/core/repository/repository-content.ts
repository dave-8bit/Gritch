import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';

import { resolveRepositoryIdentity, type RepositoryIdentity } from './repository.identity';
import { normalizeRepositoryPath } from './repository.file-index';

/**
 * Filesystem-backed repository content reading.
 *
 * This module is the only place that reads repository *file contents*. It is
 * deliberately narrow:
 *
 * - It never writes, creates, or mutates anything (no caching, no temp files).
 * - It only reads text files that live inside the resolved repository root.
 * - It fails closed: any input it cannot prove safe is answered with
 *   `undefined`, never with a guess or with content from outside the
 *   repository.
 *
 * "Not read" is always reported as `undefined`, so callers can never mistake a
 * skipped file for an examined one.
 */

/** Maximum number of characters returned for a single file. */
export const DEFAULT_PER_FILE_CHAR_LIMIT = 8000;

/** Maximum number of files returned by a single `readMany` call. */
export const DEFAULT_MAX_FILES = 40;

/** Files larger than this are skipped before being read into memory. */
export const DEFAULT_MAX_FILE_BYTES = 512 * 1024;

/**
 * Extensions that are never text. These are skipped without reading, so a
 * 200MB archive is never loaded just to discover it is binary.
 */
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tiff', '.tif',
  '.pdf', '.psd', '.ai', '.eps',
  '.zip', '.gz', '.tgz', '.tar', '.bz2', '.xz', '.7z', '.rar', '.jar', '.war',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.class', '.o', '.a', '.obj', '.lib', '.pdb',
  '.wasm', '.node',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.mov', '.avi', '.wav', '.webm', '.ogg', '.flac',
  '.sqlite', '.sqlite3', '.db', '.mdb', '.dat',
  '.pyc', '.pyo', '.lockb', '.pack', '.parquet', '.avro',
]);

/**
 * Share of control characters above which decoded text is treated as binary.
 * Only applied to content long enough for the ratio to be meaningful.
 */
const CONTROL_CHARACTER_RATIO_LIMIT = 0.3;
const CONTROL_CHARACTER_SAMPLE_MINIMUM = 32;

export interface RepositoryFileContent {
  /** Normalized repository-relative posix path. */
  relativePath: string;
  /** Decoded text content (possibly truncated to the per-file limit). */
  content: string;
  /** Size of the file on disk in bytes. */
  sizeBytes: number;
  /** True when {@link content} was cut at the per-file character limit. */
  truncated: boolean;
}

export interface RepositoryContentReader {
  readText(
    repositoryPath: string,
    relativePath: string
  ): RepositoryFileContent | undefined;

  readMany(
    repositoryPath: string,
    relativePaths: string[]
  ): RepositoryFileContent[];
}

export interface RepositoryContentReaderOptions {
  /** Maximum characters returned per file. Defaults to {@link DEFAULT_PER_FILE_CHAR_LIMIT}. */
  perFileCharLimit?: number;
  /** Maximum files returned per `readMany` call. Defaults to {@link DEFAULT_MAX_FILES}. */
  maxFiles?: number;
  /** Maximum file size in bytes before a file is skipped. Defaults to {@link DEFAULT_MAX_FILE_BYTES}. */
  maxFileBytes?: number;
  /** Repository identity resolution seam (tests). */
  resolveIdentity?: (repositoryPath?: string) => RepositoryIdentity;
}

/** True for posix-absolute, drive-absolute, and UNC paths on any platform. */
function isAbsolutePath(value: string): boolean {
  return path.posix.isAbsolute(value)
    || path.win32.isAbsolute(value)
    || /^[A-Za-z]:/.test(value)
    || value.startsWith('\\\\');
}

/** True when `target` is the root itself or a descendant of it. */
function isInsideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isKnownBinaryPath(normalizedPath: string): boolean {
  const extensionIndex = normalizedPath.lastIndexOf('.');
  const lastSlash = normalizedPath.lastIndexOf('/');
  if (extensionIndex <= lastSlash) return false;
  return BINARY_EXTENSIONS.has(normalizedPath.slice(extensionIndex).toLowerCase());
}

/**
 * Decodes strict UTF-8. Invalid byte sequences are treated as non-text rather
 * than being silently replaced with U+FFFD, so a caller never acts on
 * corrupted source content.
 */
function decodeUtf8(buffer: Buffer): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return undefined;
  }
}

/** Conservative binary heuristic for decoded text without NUL bytes. */
function looksLikeBinaryText(text: string): boolean {
  if (text.length < CONTROL_CHARACTER_SAMPLE_MINIMUM) return false;

  let controlCharacters = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      controlCharacters += 1;
    }
  }
  if (controlCharacters === 0) return false;

  return controlCharacters / text.length > CONTROL_CHARACTER_RATIO_LIMIT;
}
/**
 * Reads text content of repository files. Deterministic and read-only.
 *
 * Rejection rules (all answered with `undefined`):
 * - empty, absolute, or traversal (`..`) paths
 * - anything under `.git/` (repository metadata is not source content)
 * - known binary extensions, NUL-containing content, invalid UTF-8, and
 *   content that is mostly control characters
 * - files larger than the size limit, directories, missing paths, and paths
 *   whose resolved location leaves the repository (including symlink escapes)
 */
export class FileSystemRepositoryContentReader implements RepositoryContentReader {
  private readonly perFileCharLimit: number;
  private readonly maxFiles: number;
  private readonly maxFileBytes: number;
  private readonly resolveIdentity: (repositoryPath?: string) => RepositoryIdentity;

  constructor(options: RepositoryContentReaderOptions = {}) {
    this.perFileCharLimit = options.perFileCharLimit ?? DEFAULT_PER_FILE_CHAR_LIMIT;
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.resolveIdentity = options.resolveIdentity ?? resolveRepositoryIdentity;
  }

  readText(repositoryPath: string, relativePath: string): RepositoryFileContent | undefined {
    if (typeof relativePath !== 'string' || relativePath.trim() === '') return undefined;
    if (isAbsolutePath(relativePath)) return undefined;
    if (relativePath.includes('\0')) return undefined;

    const normalized = normalizeRepositoryPath(relativePath);
    if (!normalized) return undefined;
    const segments = normalized.split('/');
    if (segments.includes('..')) return undefined;
    if (segments[0] === '.git') return undefined;
    if (isKnownBinaryPath(normalized)) return undefined;

    const root = this.resolveIdentity(repositoryPath).root;
    const absolutePath = path.resolve(root, normalized);
    if (!isInsideRoot(root, absolutePath)) return undefined;

    let realPath: string;
    let stats: fs.Stats;
    try {
      // Resolving the real path before reading also rejects symlinks that
      // point outside the repository.
      realPath = fs.realpathSync(absolutePath);
      stats = fs.statSync(realPath);
    } catch {
      return undefined;
    }

    if (!stats.isFile()) return undefined;
    if (!isInsideRoot(root, realPath)) return undefined;
    if (stats.size > this.maxFileBytes) return undefined;

    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(realPath);
    } catch {
      return undefined;
    }

    if (buffer.includes(0)) return undefined;

    const text = decodeUtf8(buffer);
    if (text === undefined) return undefined;
    if (looksLikeBinaryText(text)) return undefined;

    const truncated = text.length > this.perFileCharLimit;
    return {
      relativePath: normalized,
      content: truncated ? truncateText(text, this.perFileCharLimit) : text,
      sizeBytes: stats.size,
      truncated,
    };
  }

  /**
   * Reads several files in the caller's order. Duplicate requested paths are
   * read once, unreadable paths are skipped (never fabricated), and the result
   * is capped at the configured file limit — so the output is a deterministic
   * function of the request.
   */
  readMany(repositoryPath: string, relativePaths: string[]): RepositoryFileContent[] {
    const results: RepositoryFileContent[] = [];
    const seen = new Set<string>();

    for (const relativePath of relativePaths) {
      if (results.length >= this.maxFiles) break;
      if (typeof relativePath !== 'string') continue;

      const normalized = normalizeRepositoryPath(relativePath);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);

      const content = this.readText(repositoryPath, relativePath);
      if (content) results.push(content);
    }

    return results;
  }
}

export function createRepositoryContentReader(
  options: RepositoryContentReaderOptions = {},
): RepositoryContentReader {
  return new FileSystemRepositoryContentReader(options);
}

/** Slices at the limit without leaving a dangling high surrogate behind. */
function truncateText(text: string, limit: number): string {
  if (limit <= 0) return '';
  const slice = text.slice(0, limit);
  const lastCode = slice.charCodeAt(slice.length - 1);
  return lastCode >= 0xd800 && lastCode <= 0xdbff ? slice.slice(0, -1) : slice;
}