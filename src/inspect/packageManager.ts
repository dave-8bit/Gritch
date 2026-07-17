import path from 'path';
import type { InventoryResult } from './types';
import { buildFileInventory } from './inventory';
import { readJsonSafe, fileExists } from './fs';

export type DetectedPackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';

export interface PackageManagerDetectionResult {
  detected: Exclude<DetectedPackageManager, 'unknown'> | 'unknown';
  confidence: number; // 0..1
  evidence: string[];
}

const LOCKFILES: Array<{
  manager: Exclude<DetectedPackageManager, 'unknown'>;
  file: string;
}> = [
  { manager: 'npm', file: 'package-lock.json' },
  { manager: 'pnpm', file: 'pnpm-lock.yaml' },
]