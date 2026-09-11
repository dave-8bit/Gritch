import type { RepositoryProfile } from '../../inspect/profile';
import type { RepositoryIdentity } from './repository.identity';
import type { RepositoryWorktreeState } from './repository.state';

export const CURRENT_SERIALIZATION_VERSION = 2;

export interface PersistedRepositoryState {
  headRevision?: string;
  worktreeState: RepositoryWorktreeState;
  statusFingerprint: string;
  inspectionVersion: number;
}

export interface RepositorySnapshot {
  identity: RepositoryIdentity;
  sourceRevision?: string;
  repositoryState: PersistedRepositoryState;
  capturedAt: string;
  serializationVersion: number;
  profile: RepositoryProfile;
}

interface SerializedDependencyIndex {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  all: string[];
  packageManager?: string;
  scripts?: Record<string, string>;
}

interface SerializedRepositoryProfile extends Omit<RepositoryProfile, 'dependencies'> {
  dependencies: SerializedDependencyIndex;
}

interface SerializedRepositorySnapshot {
  identity: RepositoryIdentity;
  sourceRevision?: string;
  repositoryState: PersistedRepositoryState;
  capturedAt: string;
  serializationVersion: number;
  profile: SerializedRepositoryProfile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(isString);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isConfidence(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isDetectionResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOptionalString(value.primary) &&
    isStringArray(value.secondary) &&
    isConfidence(value.confidence) &&
    isStringArray(value.evidence)
  );
}

function isInventorySummary(value: unknown): boolean {
  if (!isRecord(value) || !Number.isInteger(value.fileCount) || !Number.isInteger(value.totalSizeBytes)) {
    return false;
  }

  return (value.fileCount as number) >= 0 && (value.totalSizeBytes as number) >= 0;
}

function isDependencies(value: unknown): value is SerializedDependencyIndex {
  return (
    isRecord(value) &&
    isStringRecord(value.dependencies) &&
    isStringRecord(value.devDependencies) &&
    isStringArray(value.all) &&
    isOptionalString(value.packageManager) &&
    (value.scripts === undefined || isStringRecord(value.scripts))
  );
}

function isRepositoryState(value: unknown): value is PersistedRepositoryState {
  return isRecord(value) &&
    isOptionalString(value.headRevision) &&
    ['clean', 'dirty', 'unborn', 'detached', 'non-git'].includes(String(value.worktreeState)) &&
    isString(value.statusFingerprint) &&
    Number.isInteger(value.inspectionVersion) &&
    (value.inspectionVersion as number) >= 1;
}

function isPackageManager(value: unknown): boolean {
  return isRecord(value) &&
    ['npm', 'pnpm', 'yarn', 'bun', 'unknown'].includes(String(value.detected)) &&
    isConfidence(value.confidence) &&
    isStringArray(value.evidence);
}

function isArchitecture(value: unknown): boolean {
  if (!isRecord(value) || typeof value.monorepo !== 'boolean' || !isConfidence(value.confidence)) {
    return false;
  }

  const workspaceManagers = ['npm', 'pnpm', 'yarn', 'turbo', 'nx', 'rush', 'lerna'];
  return isOptionalString(value.workspaceManager) &&
    (value.workspaceManager === undefined || workspaceManagers.includes(value.workspaceManager)) &&
    isStringArray(value.evidence) &&
    isRecord(value.directories) &&
    ['apps', 'packages', 'libs', 'services', 'frontend', 'backend', 'api', 'functions']
      .every((key) => typeof (value.directories as Record<string, unknown>)[key] === 'boolean');
}

function isHealth(value: unknown): boolean {
  if (!isRecord(value) || !isFiniteNumber(value.score) || value.score < 0 || value.score > 100) {
    return false;
  }

  return ['Excellent', 'Good', 'Fair', 'Poor'].includes(String(value.grade)) &&
    isStringArray(value.recommendations) &&
    isStringArray(value.evidence) &&
    isStringArray(value.present) &&
    isStringArray(value.missing);
}

function isSerializedProfile(value: unknown): value is SerializedRepositoryProfile {
  if (!isRecord(value)) return false;

  return isString(value.root) &&
    isOptionalString(value.rootEvidence) &&
    isInventorySummary(value.inventory) &&
    isDetectionResult(value.languages) &&
    isDetectionResult(value.frameworks) &&
    isDetectionResult(value.buildTools) &&
    isPackageManager(value.packageManager) &&
    isDependencies(value.dependencies) &&
    isDetectionResult(value.testing) &&
    isDetectionResult(value.linting) &&
    isDetectionResult(value.formatting) &&
    isDetectionResult(value.database) &&
    isDetectionResult(value.orm) &&
    isArchitecture(value.architecture) &&
    isHealth(value.health);
}

function isSerializedSnapshot(value: unknown): value is SerializedRepositorySnapshot {
  return (
    isRecord(value) &&
    isRecord(value.identity) &&
    isString(value.identity.root) &&
    isString(value.identity.key) &&
    value.identity.root === value.identity.key &&
    isOptionalString(value.sourceRevision) &&
    isRepositoryState(value.repositoryState) &&
    value.sourceRevision === value.repositoryState.headRevision &&
    isString(value.capturedAt) &&
    !Number.isNaN(Date.parse(value.capturedAt)) &&
    value.serializationVersion === CURRENT_SERIALIZATION_VERSION &&
    isSerializedProfile(value.profile)
  );
}

function toSerializedProfile(profile: RepositoryProfile): SerializedRepositoryProfile {
  return {
    root: profile.root,
    rootEvidence: profile.rootEvidence,
    inventory: profile.inventory,
    languages: profile.languages,
    frameworks: profile.frameworks,
    buildTools: profile.buildTools,
    packageManager: profile.packageManager,
    dependencies: {
      dependencies: { ...profile.dependencies.dependencies },
      devDependencies: { ...profile.dependencies.devDependencies },
      all: Array.from(profile.dependencies.all),
      packageManager: profile.dependencies.packageManager,
      scripts: profile.dependencies.scripts ? { ...profile.dependencies.scripts } : undefined,
    },
    testing: profile.testing,
    linting: profile.linting,
    formatting: profile.formatting,
    database: profile.database,
    orm: profile.orm,
    architecture: profile.architecture,
    health: profile.health,
  };
}

function fromSerializedProfile(profile: SerializedRepositoryProfile): RepositoryProfile {
  return {
    ...profile,
    dependencies: {
      ...profile.dependencies,
      all: new Set(profile.dependencies.all),
    },
  };
}

export function serializeRepositorySnapshot(snapshot: RepositorySnapshot): string {
  if (!isSerializedSnapshot({
    ...snapshot,
    profile: toSerializedProfile(snapshot.profile),
  })) {
    throw new Error('Cannot serialize invalid repository snapshot');
  }

  const serialized: SerializedRepositorySnapshot = {
    identity: { ...snapshot.identity },
    sourceRevision: snapshot.sourceRevision,
    repositoryState: {
      ...snapshot.repositoryState,
    },
    capturedAt: snapshot.capturedAt,
    serializationVersion: CURRENT_SERIALIZATION_VERSION,
    profile: toSerializedProfile(snapshot.profile),
  };

  return JSON.stringify(serialized);
}

export function deserializeRepositorySnapshot(serialized: string): RepositorySnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Invalid repository snapshot JSON');
  }

  if (!isSerializedSnapshot(parsed)) {
    throw new Error('Invalid or incompatible repository snapshot');
  }

  return {
    identity: { ...parsed.identity },
    sourceRevision: parsed.sourceRevision,
    repositoryState: {
      ...parsed.repositoryState,
    },
    capturedAt: parsed.capturedAt,
    serializationVersion: parsed.serializationVersion,
    profile: fromSerializedProfile(parsed.profile),
  };
}