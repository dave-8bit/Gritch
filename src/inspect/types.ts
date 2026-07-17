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

