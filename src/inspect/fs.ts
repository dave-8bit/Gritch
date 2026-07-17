import fs from 'fs';
import path from 'path';

/** Never throws: returns true if file exists and is readable as a file. */
export function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function readFileTextSafe(filePath: string, encoding: BufferEncoding = 'utf8'): string | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    return fs.readFileSync(filePath, { encoding });
  } catch {
    return undefined;
  }
}

export function readJsonSafe<T = unknown>(filePath: string): T | undefined {
  const raw = readFileTextSafe(filePath, 'utf8');
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function normalizeToPosix(p: string): string {
  return p.split(path.sep).join('/');
}

