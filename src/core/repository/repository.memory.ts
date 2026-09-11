import { inspectRepository, type RepositoryProfile } from '../../inspect/profile';
import { SqliteRepositoryPersistence } from '../storage/sqlite.repository-persistence';
import {
  InvalidRepositoryCacheError,
  RepositoryPersistenceError,
  type RepositoryPersistence,
} from './repository.persistence';
import { resolveRepositoryIdentity, type RepositoryIdentity } from './repository.identity';
import {
  CURRENT_SERIALIZATION_VERSION,
  type PersistedRepositoryState,
  type RepositorySnapshot,
} from './repository.snapshot';
import { observeRepositoryState, type RepositoryState } from './repository.state';

export interface RepositoryMemory {
  getSnapshot(repositoryPath?: string): Promise<RepositorySnapshot>;
  refresh(repositoryPath?: string): Promise<RepositorySnapshot>;
}

export interface RepositoryMemoryDependencies {
  persistence: RepositoryPersistence;
  inspect: (repositoryPath: string) => RepositoryProfile;
  resolveIdentity: (repositoryPath?: string) => RepositoryIdentity;
  observeState: (repositoryPath: string) => Promise<RepositoryState>;
}

export type RepositoryMemoryOptions = Partial<RepositoryMemoryDependencies>;

function matchesCurrentRepository(
  snapshot: RepositorySnapshot,
  identity: RepositoryIdentity,
  state: PersistedRepositoryState,
): boolean {
  if (state.worktreeState === 'dirty') return false;

  return snapshot.identity.root === identity.root &&
    snapshot.identity.key === identity.key &&
    snapshot.sourceRevision === state.headRevision &&
    snapshot.serializationVersion === CURRENT_SERIALIZATION_VERSION &&
    snapshot.repositoryState.worktreeState === state.worktreeState &&
    snapshot.repositoryState.headRevision === state.headRevision &&
    snapshot.repositoryState.statusFingerprint === state.statusFingerprint &&
    snapshot.repositoryState.inspectionVersion === state.inspectionVersion;
}

export class RepositoryMemoryCoordinator implements RepositoryMemory {
  private readonly dependencies: RepositoryMemoryDependencies;

  constructor(options: RepositoryMemoryOptions = {}) {
    this.dependencies = {
      persistence: options.persistence ?? new SqliteRepositoryPersistence(),
      inspect: options.inspect ?? inspectRepository,
      resolveIdentity: options.resolveIdentity ?? resolveRepositoryIdentity,
      observeState: options.observeState ?? observeRepositoryState,
    };
  }

  async getSnapshot(repositoryPath?: string): Promise<RepositorySnapshot> {
    const identity = this.dependencies.resolveIdentity(repositoryPath);
    const observed = await this.dependencies.observeState(identity.root);
    const state: PersistedRepositoryState = {
      headRevision: observed.headRevision,
      worktreeState: observed.worktreeState,
      statusFingerprint: observed.status.fingerprint,
      inspectionVersion: observed.inspectionVersion,
    };

    let persisted: RepositorySnapshot | undefined;
    try {
      persisted = this.dependencies.persistence.load(identity);
    } catch (error) {
      if (!(error instanceof InvalidRepositoryCacheError) &&
          !(error instanceof RepositoryPersistenceError)) {
        throw error;
      }
    }

    if (persisted && matchesCurrentRepository(persisted, identity, state)) {
      return persisted;
    }

    return this.createFreshSnapshot(identity, state);
  }

  async refresh(repositoryPath?: string): Promise<RepositorySnapshot> {
    const identity = this.dependencies.resolveIdentity(repositoryPath);
    const observed = await this.dependencies.observeState(identity.root);
    const state: PersistedRepositoryState = {
      headRevision: observed.headRevision,
      worktreeState: observed.worktreeState,
      statusFingerprint: observed.status.fingerprint,
      inspectionVersion: observed.inspectionVersion,
    };

    return this.createFreshSnapshot(identity, state);
  }

  private async createFreshSnapshot(
    identity: RepositoryIdentity,
    repositoryState: PersistedRepositoryState,
  ): Promise<RepositorySnapshot> {
    const snapshot: RepositorySnapshot = {
      identity,
      sourceRevision: repositoryState.headRevision,
      repositoryState,
      capturedAt: new Date().toISOString(),
      serializationVersion: CURRENT_SERIALIZATION_VERSION,
      profile: this.dependencies.inspect(identity.root),
    };

    try {
      this.dependencies.persistence.save(snapshot);
    } catch (error) {
      if (!(error instanceof RepositoryPersistenceError)) {
        throw error;
      }
    }

    return snapshot;
  }
}

export function createRepositoryMemory(options: RepositoryMemoryOptions = {}): RepositoryMemory {
  return new RepositoryMemoryCoordinator(options);
}