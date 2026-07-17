import path from 'path';
import { readJsonSafe } from './fs';
import type { InventoryResult } from './types';
import { buildFileInventory } from './inventory';

export type DetectedLanguage =
  | 'TypeScript'
  | 'JavaScript'
  | 'Python'
  | 'Go'
  | 'Rust'
  | 'Java'
  | 'C#'
  | 'C++'
  | 'C'
  | 'PHP'
  | 'Ruby'
  | 'Kotlin'
  | 'Swift'
  | 'unknown';

export interface LanguageDetectionResult {
  primary: Exclude<DetectedLanguage, 'unknown'>;
  secondary: Exclude<DetectedLanguage, 'unknown'>[];
  confidence: number; // 0..1
  evidence: string[];
}

type LangScore = { lang: Exclude<DetectedLanguage, 'unknown'>; score: number };

const EXTENSION_RULES: Array<{
  lang: Exclude<DetectedLanguage, 'unknown'>;
  exts: string[];
  weight: number;
}> = [
  { lang: 'TypeScript', exts: ['.ts'], weight: 1.2 },
  { lang: 'TypeScript', exts: ['.tsx'], weight: 1.5 },
  { lang: 'JavaScript', exts: ['.js'], weight: 1.0 },
  { lang: 'JavaScript', exts: ['.jsx'], weight: 1.2 },
  { lang: 'Python', exts: ['.py'], weight: 1.2 },
  { lang: 'Go', exts: ['.go'], weight: 1.2 },
  { lang: 'Rust', exts: ['.rs'], weight: 1.2 },
  { lang: 'Java', exts: ['.java'], weight: 1.2 },
  { lang: 'C#', exts: ['.cs'], weight: 1.2 },
  { lang: 'C++', exts: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'], weight: 1.2 },
  { lang: 'C', exts: ['.c', '.h'], weight: 0.9 },
  { lang: 'PHP', exts: ['.php', '.phtml'], weight: 1.1 },
  { lang: 'Ruby', exts: ['.rb'], weight: 1.1 },
  { lang: 'Kotlin', exts: ['.kt', '.kts'], weight: 1.2 },
  { lang: 'Swift', exts: ['.swift'], weight: 1.2 },
];

const EXT_TO_LANG_RULES: Array<{ ext: string; lang: Exclude<DetectedLanguage, 'unknown'>; weight: number }> = [];
for (const rule of EXTENSION_RULES) {
  for (const ext of rule.exts) {
    EXT_TO_LANG_RULES.push({ ext, lang: rule.lang, weight: rule.weight });
  }
}

function extLower(p: string): string {
  return path.extname(p).toLowerCase();
}

function scoreFromInventory(inv: InventoryResult): { scores: LangScore[]; evidence: string[]; totalFiles: number } {
  const scoresMap = new Map<Exclude<DetectedLanguage, 'unknown'>, number>();
  const evidence: string[] = [];
  let totalFiles = 0;

  for (const f of inv.files) {
    const ext = extLower(f.path);
    if (!ext) continue;

    const rule = EXT_TO_LANG_RULES.find((r) => r.ext === ext);
    if (!rule) continue;

    totalFiles++;
    const prev = scoresMap.get(rule.lang) ?? 0;
    const next = prev + rule.weight;
    scoresMap.set(rule.lang, next);

    // Evidence: keep it lightweight (don’t dump entire file list)
    if (evidence.length < 25) {
      evidence.push(`${rule.lang}<- ${f.path}`);
    }
  }

  const scores: LangScore[] = Array.from(scoresMap.entries())
    .map(([lang, score]) => ({ lang, score }))
    .sort((a, b) => b.score - a.score);

  return { scores, evidence, totalFiles };
}

function applyManifestHints(rootPath: string, scores: Map<Exclude<DetectedLanguage, 'unknown'>, number>, evidence: string[]): void {
  // Hints are ONLY additive; no detection-only logic.
  // - package.json type/module only helps JS/TS split a bit
  // - pyproject.toml / requirements.txt hints Python
  // - Cargo.toml hints Rust
  // - go.mod hints Go
  // - pom.xml hints Java
  // - Gemfile hints Ruby
  // - composer.json hints PHP
  const jsTsBoost = (hint: 'TypeScript' | 'JavaScript', delta: number) => {
    scores.set(hint, (scores.get(hint) ?? 0) + delta);
    if (evidence.length < 25) evidence.push(`manifest hint: ${hint} (+${delta})`);
  };

  const pythonBoost = (delta: number) => {
    scores.set('Python', (scores.get('Python') ?? 0) + delta);
    if (evidence.length < 25) evidence.push(`manifest hint: Python (+${delta})`);
  };

  const simpleExistsHint = (filename: string) => {
    // Use inventory-based approach would be better; but we can safely check presence via inventory
    // in detectLanguages(). Here we approximate by reading nothing (no throws) and applying only if file exists.
  };

  const pkg = readJsonSafe<{ type?: string }>(path.join(rootPath, 'package.json'));
  if (pkg) {
    const t = pkg.type;
    if (t === 'module') {
      jsTsBoost('JavaScript', 0.2);
    }
    // package.json scripts could exist; but we avoid deeper parsing.
    // If tsconfig exists, it will also be applied below.
  }

  if (readJsonSafe(path.join(rootPath, 'tsconfig.json')) !== undefined) {
    // tsconfig.json presence is a strong hint for TS
    jsTsBoost('TypeScript', 0.4);
  }

  // Common build manifest markers (handled via safe JSON reads only where JSON)
  if (readJsonSafe(path.join(rootPath, 'composer.json')) !== undefined) {
    scores.set('PHP', (scores.get('PHP') ?? 0) + 0.3);
    if (evidence.length < 25) evidence.push('manifest hint: PHP (+0.3)');
  }

  if (readJsonSafe(path.join(rootPath, 'Cargo.toml')) !== undefined) {
    // Cargo.toml is not JSON, so readJsonSafe will return undefined.
    // Kept intentionally no-op.
  }

  // Non-JSON hint files: avoid fs checks here to keep module minimal; inventory-based detection is enough.
  // We still handle tsconfig & package.json only.
}

export function detectLanguagesFromInventory(inv: InventoryResult): LanguageDetectionResult {
  const { scores, evidence, totalFiles } = scoreFromInventory(inv);

  if (scores.length === 0) {
    // empty/unknown repo
    return {
      primary: 'TypeScript',
      secondary: [],
      confidence: 0,
      evidence: ['No known language extensions found'],
    };
  }

  const primary = scores[0].lang;
  const second = scores[1]?.lang;

  const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
  const primaryScore = scores[0].score;
  const ratio = totalScore > 0 ? primaryScore / totalScore : 0;

  // Confidence based on ratio; reduce if close competitor.
  const secondScore = scores[1]?.score ?? 0;
  const closenessPenalty = secondScore > 0 && (primaryScore - secondScore) / primaryScore < 0.15 ? 0.12 : 0;

  const confidence = Math.max(0, Math.min(1, ratio - closenessPenalty));

  const secondary = scores.slice(1, 4).map((s) => s.lang);

  return {
    primary,
    secondary: second ? secondary : [],
    confidence,
    evidence,
  };
}

export function detectLanguages(rootPath?: string): LanguageDetectionResult {
  const resolvedRoot = rootPath ? path.resolve(rootPath) : process.cwd();
  const inv = buildFileInventory({ rootPath: resolvedRoot, maxDepth: 6, maxFiles: 50_000 });

  // Apply manifest hints (additive) to scores.
  const { scores: initialScores, evidence } = scoreFromInventory(inv);
  const scoresMap = new Map<Exclude<DetectedLanguage, 'unknown'>, number>();
  for (const s of initialScores) scoresMap.set(s.lang, s.score);

  // apply hints without changing shape
  applyManifestHints(inv.root, scoresMap, evidence);

  const scores = Array.from(scoresMap.entries())
    .map(([lang, score]) => ({ lang, score }))
    .sort((a, b) => b.score - a.score);

  if (scores.length === 0) {
    return {
      primary: 'TypeScript',
      secondary: [],
      confidence: 0,
      evidence: ['No known language extensions found'],
    };
  }

  const primary = scores[0].lang;
  const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
  const ratio = totalScore > 0 ? scores[0].score / totalScore : 0;
  const secondScore = scores[1]?.score ?? 0;
  const closenessPenalty = secondScore > 0 && (scores[0].score - secondScore) / scores[0].score < 0.15 ? 0.12 : 0;

  return {
    primary,
    secondary: scores.slice(1, 4).map((s) => s.lang),
    confidence: Math.max(0, Math.min(1, ratio - closenessPenalty)),
    evidence,
  };
}

export function detectLanguagesWithInventory(rootPath: string, inv?: InventoryResult): LanguageDetectionResult {
  const actualInv = inv ?? buildFileInventory({ rootPath, maxDepth: 6, maxFiles: 50_000 });
  return detectLanguagesFromInventory(actualInv);
}

