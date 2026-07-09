import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mock fs before importing config.service
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  },
}));

import fs from 'fs';
import type { PathLike } from 'fs';

import * as configService from '../../src/core/config/config.service';
import path from 'path';

const gritchConfigPath = path.join(process.cwd(), 'gritch.config.json');
const gitwiseConfigPath = path.join(process.cwd(), 'gitwise.config.json');

describe('ConfigService loadConfig()', () => {
  const existsSyncMock = vi.mocked(fs.existsSync);
  const readFileSyncMock = vi.mocked(fs.readFileSync);

  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.GRITCH_PROVIDER;

    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    existsSyncMock.mockReset();
    readFileSyncMock.mockReset();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns defaultConfig when no config files exist', () => {
    existsSyncMock.mockReturnValue(false);

    const cfg = configService.loadConfig();
    expect(cfg).toEqual(configService.defaultConfig);
  });

  it('loads gritch.config.json when present', () => {
    existsSyncMock.mockImplementation((p) => String(p) === gritchConfigPath);
    readFileSyncMock.mockImplementation(() =>

      JSON.stringify({ model: 'custom-model', maxTokens: 111 })
    );

    const cfg = configService.loadConfig();
    expect(cfg.model).toBe('custom-model');
    expect(cfg.maxTokens).toBe(111);
    expect(cfg.reviewThreshold).toBe(configService.defaultConfig.reviewThreshold);
  });

  it('falls back to gitwise.config.json when gritch.config.json does not exist', () => {
    existsSyncMock.mockImplementation((p) => String(p) === gitwiseConfigPath);
    readFileSyncMock.mockImplementation(() =>

      JSON.stringify({ reviewThreshold: 3, conventionalCommits: false })
    );

    const cfg = configService.loadConfig();
    expect(cfg.reviewThreshold).toBe(3);
    expect(cfg.conventionalCommits).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('DEPRECATION WARNING'));
  });

  it('prefers gritch.config.json when both config files exist', () => {
    existsSyncMock.mockImplementation((p) => String(p) === gritchConfigPath || String(p) === gitwiseConfigPath);

    readFileSyncMock.mockImplementation((p) =>

      p === gritchConfigPath ? JSON.stringify({ reviewThreshold: 9 }) : JSON.stringify({ reviewThreshold: 1 })
    );

    const cfg = configService.loadConfig();
    expect(cfg.reviewThreshold).toBe(9);
  });

  it('returns defaults when JSON is malformed', () => {
    existsSyncMock.mockImplementation((p) => p === gritchConfigPath);

    readFileSyncMock.mockImplementation(() => '{ this is not valid json');

    const cfg = configService.loadConfig();
    expect(cfg).toEqual(configService.defaultConfig);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not load gritch.config.json')
    );
  });

  it('emits expected warning for malformed JSON in legacy file', () => {
    existsSyncMock.mockImplementation((p) => String(p) === gitwiseConfigPath);
    readFileSyncMock.mockImplementation(() => '{ bad');

    configService.loadConfig();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('DEPRECATION WARNING'));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not load gitwise.config.json')
    );
  });

  it('emits expected deprecation warning when loading gitwise.config.json', () => {
    existsSyncMock.mockImplementation((p) => String(p) === gitwiseConfigPath);
    readFileSyncMock.mockImplementation(() => JSON.stringify({ model: 'legacy-model' }));

    const cfg = configService.loadConfig();
    expect(cfg.model).toBe('legacy-model');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('DEPRECATION WARNING'));
  });

  it('correctly merges partial configuration onto defaultConfig', () => {
    existsSyncMock.mockImplementation((p) => String(p) === gritchConfigPath);
    readFileSyncMock.mockImplementation(() => JSON.stringify({ conventionalCommits: false }));

    const cfg = configService.loadConfig();
    expect(cfg.conventionalCommits).toBe(false);
    expect(cfg.model).toBe(configService.defaultConfig.model);
    expect(cfg.reviewThreshold).toBe(configService.defaultConfig.reviewThreshold);
  });
});


