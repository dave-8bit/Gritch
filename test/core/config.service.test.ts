import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { vi } from 'vitest';
import fs from 'fs';

vi.mock('fs', () => fs);

import * as configService from '../../src/core/config/config.service';



// Ensure module uses our mocked fs instance (config.service imports `fs` as default).


describe('ConfigService loadConfig()', () => {
  const cwd = process.cwd();

  let existsSyncSpy: ReturnType<typeof vi.spyOn>;
  let readFileSyncSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.GRITCH_PROVIDER;

    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReset();
    readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockReset();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    existsSyncSpy.mockRestore();
    readFileSyncSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('returns defaultConfig when no config files exist', () => {
    existsSyncSpy.mockReturnValue(false);

    const cfg = configService.loadConfig();
    expect(cfg).toEqual(configService.defaultConfig);
  });

  it('loads gritch.config.json when present', () => {
    existsSyncSpy.mockImplementation((p: string) => p === `${cwd}/gritch.config.json`);
    readFileSyncSpy.mockImplementation(() =>
      JSON.stringify({ model: 'custom-model', maxTokens: 111 })
    );

    const cfg = configService.loadConfig();
    expect(cfg.model).toBe('custom-model');
    expect(cfg.maxTokens).toBe(111);
    expect(cfg.reviewThreshold).toBe(configService.defaultConfig.reviewThreshold);
  });

  it('falls back to gitwise.config.json when gritch.config.json does not exist', () => {
    existsSyncSpy.mockImplementation((p: string) => p === `${cwd}/gitwise.config.json`);
    readFileSyncSpy.mockImplementation(() =>
      JSON.stringify({ reviewThreshold: 3, conventionalCommits: false })
    );

    const cfg = configService.loadConfig();
    expect(cfg.reviewThreshold).toBe(3);
    expect(cfg.conventionalCommits).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('DEPRECATION WARNING'));
  });

  it('prefers gritch.config.json when both config files exist', () => {
    existsSyncSpy.mockImplementation(
      (p: string) => p === `${cwd}/gritch.config.json` || p === `${cwd}/gitwise.config.json`
    );

    readFileSyncSpy.mockImplementation((p: string) =>
      p === `${cwd}/gritch.config.json`
        ? JSON.stringify({ reviewThreshold: 9 })
        : JSON.stringify({ reviewThreshold: 1 })
    );

    const cfg = configService.loadConfig();
    expect(cfg.reviewThreshold).toBe(9);
  });

  it('returns defaults when JSON is malformed', () => {
    existsSyncSpy.mockImplementation((p: string) => p === `${cwd}/gritch.config.json`);
    readFileSyncSpy.mockImplementation(() => '{ this is not valid json');

    const cfg = configService.loadConfig();
    expect(cfg).toEqual(configService.defaultConfig);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not load gritch.config.json')
    );
  });

  it('emits expected warning for malformed JSON in legacy file', () => {
    existsSyncSpy.mockImplementation((p: string) => p === `${cwd}/gitwise.config.json`);
    readFileSyncSpy.mockImplementation(() => '{ bad');

    configService.loadConfig();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('DEPRECATION WARNING'));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not load gitwise.config.json')
    );
  });

  it('emits expected deprecation warning when loading gitwise.config.json', () => {
    existsSyncSpy.mockImplementation((p: string) => p === `${cwd}/gitwise.config.json`);
    readFileSyncSpy.mockImplementation(() => JSON.stringify({ model: 'legacy-model' }));

    const cfg = configService.loadConfig();
    expect(cfg.model).toBe('legacy-model');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('DEPRECATION WARNING'));
  });

  it('correctly merges partial configuration onto defaultConfig', () => {
    existsSyncSpy.mockImplementation((p: string) => p === `${cwd}/gritch.config.json`);
    readFileSyncSpy.mockImplementation(() => JSON.stringify({ conventionalCommits: false }));

    const cfg = configService.loadConfig();
    expect(cfg.conventionalCommits).toBe(false);
    expect(cfg.model).toBe(configService.defaultConfig.model);
    expect(cfg.reviewThreshold).toBe(configService.defaultConfig.reviewThreshold);
  });
});

