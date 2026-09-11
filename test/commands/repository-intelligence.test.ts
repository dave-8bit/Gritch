import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeRepositoryProfile } from '../helpers/repository-profile';

vi.mock('../../src/commands/repository-memory', () => ({
  repositoryMemory: {
    getSnapshot: vi.fn(),
  },
}));

import { repositoryMemory } from '../../src/commands/repository-memory';
import { inspectCommand } from '../../src/commands/inspect';
import { contextCommand } from '../../src/commands/context';
import { architectureCommand } from '../../src/commands/architecture';
import { dependenciesCommand } from '../../src/commands/dependencies';
import { statsCommand } from '../../src/commands/stats';
import { doctorCommand } from '../../src/commands/doctor';
import type { RepositorySnapshot } from '../../src/core/repository/repository.snapshot';

const getSnapshotMock = vi.mocked(repositoryMemory.getSnapshot);

describe('repository intelligence commands', () => {
  const profile = makeRepositoryProfile();
  const snapshot = { profile } as RepositorySnapshot;

  beforeEach(() => {
    vi.clearAllMocks();
    getSnapshotMock.mockResolvedValue(snapshot);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('context uses the cached profile, respects an explicit rootPath, and prints context', async () => {
    await contextCommand('C:/repo');

    expect(getSnapshotMock).toHaveBeenCalledWith('C:/repo');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Languages: TypeScript, JavaScript'));
  });

  it('inspect uses snapshot.profile and preserves formatted output', async () => {
    await inspectCommand('src', repositoryMemory);

    expect(getSnapshotMock).toHaveBeenCalledWith('src');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Languages'));
  });

  it('context uses the default path when no rootPath is supplied', async () => {
    await contextCommand();

    expect(getSnapshotMock).toHaveBeenCalledWith(undefined);
    expect(console.log).toHaveBeenCalled();
  });

  it('context surfaces memory failures', async () => {
    getSnapshotMock.mockRejectedValue(new Error('inspection failed'));

    await expect(contextCommand()).rejects.toThrow('inspection failed');
  });

  it('architecture prints the profile architecture and respects rootPath', async () => {
    await architectureCommand('C:/repo');

    expect(getSnapshotMock).toHaveBeenCalledWith('C:/repo');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Monorepo: Yes'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Confidence: 0.88'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('package.json workspaces field'));
  });

  it('dependencies prints grouped dependency data and respects rootPath', async () => {
    await dependenciesCommand('C:/repo');

    expect(getSnapshotMock).toHaveBeenCalledWith('C:/repo');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Runtime Count: 2'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Development Count: 2'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Package Manager: npm'));
  });

  it('stats prints profile-backed statistics and respects rootPath', async () => {
    await statsCommand('C:/repo');

    expect(getSnapshotMock).toHaveBeenCalledWith('C:/repo');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Files: 12'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Total Dependencies: 4'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Build Tool: tsup'));
  });

  it('doctor prints the cached profile and respects an explicit rootPath', async () => {
    await doctorCommand('C:/repo');

    expect(getSnapshotMock).toHaveBeenCalledWith('C:/repo');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Health'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Score: 80'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Vitest'));
  });

  it('doctor forwards an omitted rootPath as undefined', async () => {
    await doctorCommand();

    expect(getSnapshotMock).toHaveBeenCalledWith(undefined);
  });

  it('doctor surfaces memory failures', async () => {
    getSnapshotMock.mockRejectedValue(new Error('inspection failed'));

    await expect(doctorCommand()).rejects.toThrow('inspection failed');
  });
});