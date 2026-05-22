import fs from 'fs';
import path from 'path';
import type { GitwiseConfig } from '../types/index';

export const defaultConfig: GitwiseConfig = {
 model: 'llama-3.3-70b-versatile',
  maxTokens: 1024,
  reviewThreshold: 7,
  conventionalCommits: true,
};

export function loadConfig(): GitwiseConfig {
  const configPath = path.join(process.cwd(), 'gitwise.config.json');

  if (!fs.existsSync(configPath)) {
    return defaultConfig;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<GitwiseConfig>;
    return { ...defaultConfig, ...parsed };
  } catch {
    console.warn('Could not load gitwise.config.json, using defaults');
    return defaultConfig;
  }
}

