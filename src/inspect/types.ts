export type PathLike = string;

export interface InventoryEntry {
  /** Absolute or repo-root-relative path (implementation choice) */
  path: string;
  /** File size in bytes (if available) */
  size?: number;
}

export interface InventoryResult {
  /** Repository root directory */
  root: string;
  /** Inventory entries */
  files: InventoryEntry[];
}

export type HealthAssetId =
  | 'README'
  | 'LICENSE'
  | 'CHANGELOG'
  | 'CONTRIBUTING'
  | 'CODE_OF_CONDUCT'
  | 'SECURITY'
  | 'Dockerfile'
  | 'docker-compose.yml'
  | '.github/workflows'
  | '.editorconfig'
  | '.env.example';

export interface RepositoryHealthResult {
  /** Score 0–100 based on ratio of present assets to total tracked assets. */
  score: number;
  /** Human-readable grade based on score thresholds. */
  grade: 'Excellent' | 'Good' | 'Fair' | 'Poor';
  /** Deterministic recommendations derived from missing assets. */
  recommendations: string[];
  /** Evidence lines (found / missing per asset). */
  evidence: string[];
  /** Asset IDs that were found in the repository. */
  present: HealthAssetId[];
  /** Asset IDs that were not found in the repository. */
  missing: HealthAssetId[];
}

