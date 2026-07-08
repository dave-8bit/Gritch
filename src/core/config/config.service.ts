import fs from 'fs';
import path from 'path';

import type { GritchConfig } from './config.types';

const GRITCH_CONFIG_FILENAME = 'gritch.config.json';
const LEGACY_GITWISE_CONFIG_FILENAME = 'gitwise.config.json';

export const defaultConfig: GritchConfig = {
  model: 'llama-3.3-70b-versatile',
  maxTokens: 1024,
  reviewThreshold: 7,
  conventionalCommits: true,
};

export function loadConfig(): GritchConfig {
  const gritchConfigPath = path.join(process.cwd(), GRITCH_CONFIG_FILENAME);
  const legacyConfigPath = path.join(process.cwd(), LEGACY_GITWISE_CONFIG_FILENAME);

  const configPath = fs.existsSync(gritchConfigPath) ? gritchConfigPath : legacyConfigPath;
  const isLegacyUsed = !fs.existsSync(gritchConfigPath) && fs.existsSync(legacyConfigPath);

  if (isLegacyUsed) {
    console.warn(
      'DEPRECATION WARNING: Using gitwise.config.json is deprecated. Please rename it to gritch.config.json. '
      + 'Support for gitwise.config.json will be removed in a future release.'
    );
  }

  if (!fs.existsSync(configPath)) {
    return defaultConfig;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<GritchConfig>;
    return { ...defaultConfig, ...parsed };
  } catch {
    const attemptedName = configPath.endsWith(LEGACY_GITWISE_CONFIG_FILENAME)
      ? LEGACY_GITWISE_CONFIG_FILENAME
      : GRITCH_CONFIG_FILENAME;
    console.warn(`Could not load ${attemptedName}, using defaults`);
    return defaultConfig;
  }
}

