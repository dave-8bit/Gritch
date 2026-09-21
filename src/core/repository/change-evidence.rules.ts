import type {
  ChangeFileCategory,
  ChangeFileRecord,
  ChangeRiskTier,
  ChangeSignals,
} from './change-evidence';
import type { RepositoryStatus } from './repository.state';
import { defaultIgnoreRules } from '../../inspect/ignore';
import { repositoryPathExtension } from './repository.file-index';

/**
 * Deterministic classification rules for changed-file evidence.
 *
 * These rules are pure path/name heuristics. They produce stable, testable
 * categories and signals. They never claim semantic understanding: a path
 * grouped under `api` or flagged by `securitySensitivePaths` is a boundary
 * heuristic, not an AST or intent analysis.
 */

/** Known code extensions. Only these may be classified as `source`. */
export const CODE_EXTENSIONS: readonly string[] = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.c', '.h',
  '.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx',
  '.cs', '.php', '.rb', '.kt', '.kts', '.swift',
  '.m', '.mm', '.scala', '.vue', '.svelte',
];

/** Risk-tier thresholds. Exported so tests can pin the boundaries. */
export const HIGH_THRESHOLD_FILES = 20;
export const HIGH_THRESHOLD_CHANGES = 1000;
export const MODERATE_THRESHOLD_FILES = 5;
export const MODERATE_THRESHOLD_CHANGES = 150;

export interface RepositoryPathContext {
  normalizedPath: string;
  segments: string[];
  basename: string;
  extension: string;
}

export function describeRepositoryPath(normalizedPath: string): RepositoryPathContext {
  const segments = normalizedPath.split('/').filter(Boolean);
  const basename = segments[segments.length - 1] ?? '';
  return {
    normalizedPath,
    segments,
    basename,
    extension: repositoryPathExtension(normalizedPath),
  };
}

// ---------------------------------------------------------------------------
// Category rule tables (first match in precedence order wins).
// ---------------------------------------------------------------------------

const DEPENDENCY_MANIFESTS: ReadonlySet<string> = new Set([
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json',
  'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
  'composer.json', 'composer.lock', 'go.mod', 'go.sum',
  'Cargo.toml', 'Cargo.lock', 'Gemfile', 'Gemfile.lock',
  'pyproject.toml', 'poetry.lock', 'uv.lock', 'Pipfile', 'Pipfile.lock',
  'requirements.txt', 'requirements-dev.txt',
  'deno.json', 'deno.jsonc', 'pubspec.yaml', 'pubspec.lock', 'mix.lock',
]);

const PACKAGE_METADATA_MANIFESTS: ReadonlySet<string> = new Set([
  'package.json', 'npm-shrinkwrap.json', 'composer.json', 'go.mod',
  'Cargo.toml', 'Gemfile', 'pyproject.toml', 'Pipfile',
  'deno.json', 'deno.jsonc', 'pubspec.yaml',
]);

const DATABASE_SEGMENTS: ReadonlySet<string> = new Set([
  'db', 'database', 'prisma', 'drizzle', 'knex', 'sequelize', 'typeorm',
]);

const DATABASE_EXTENSIONS: ReadonlySet<string> = new Set(['.sqlite', '.sqlite3', '.db']);

const PERSISTENCE_SEGMENTS: ReadonlySet<string> = new Set(['storage', 'persistence']);

const PERSISTENCE_BASENAME = /(persistence|sqlite|repository\.store|repository\.pool)/i;

const CI_BASENAMES: ReadonlySet<string> = new Set([
  '.gitlab-ci.yml', 'azure-pipelines.yml', 'azure-pipelines.yaml',
  'bitbucket-pipelines.yml', '.buildkite',
]);

const CLI_SEGMENTS: ReadonlySet<string> = new Set(['cli', 'commands', 'bin', 'cmd']);

const API_SEGMENTS: ReadonlySet<string> = new Set([
  'api', 'routes', 'controllers', 'endpoints', 'handlers',
]);

const API_BASENAME = /^(openapi|swagger)/i;

function isDependency(ctx: RepositoryPathContext): boolean {
  return DEPENDENCY_MANIFESTS.has(ctx.basename);
}

function isMigration(ctx: RepositoryPathContext): boolean {
  return ctx.segments.some((segment) => segment === 'migrations' || segment === 'migration')
    || /^V\d+__.*\.sql$/i.test(ctx.basename)
    || ctx.basename.endsWith('_up.sql')
    || ctx.basename.endsWith('_down.sql');
}

function isSchema(ctx: RepositoryPathContext): boolean {
  return ctx.extension === '.sql'
    || ctx.basename === 'schema.prisma'
    || ctx.segments.includes('schema')
    || /^schema\./i.test(ctx.basename);
}

function isDatabase(ctx: RepositoryPathContext): boolean {
  return ctx.segments.some((segment) => DATABASE_SEGMENTS.has(segment))
    || DATABASE_EXTENSIONS.has(ctx.extension);
}

function isPersistence(ctx: RepositoryPathContext): boolean {
  return ctx.segments.some((segment) => PERSISTENCE_SEGMENTS.has(segment))
    || PERSISTENCE_BASENAME.test(ctx.basename);
}

function isCi(ctx: RepositoryPathContext): boolean {
  return (ctx.segments.includes('.github') && ctx.segments.includes('workflows'))
    || ctx.segments.includes('.circleci')
    || CI_BASENAMES.has(ctx.basename)
    || ctx.basename.startsWith('Jenkinsfile');
}

function isCli(ctx: RepositoryPathContext): boolean {
  return ctx.segments.some((segment) => CLI_SEGMENTS.has(segment))
    || /^cli\.(ts|js|mjs|cjs)$/.test(ctx.basename)
    || ctx.normalizedPath === 'src/index.ts'
    || ctx.normalizedPath === 'src/main.ts'
    || ctx.normalizedPath === 'src/cli.ts';
}

function isApi(ctx: RepositoryPathContext): boolean {
  return ctx.segments.some((segment) => API_SEGMENTS.has(segment))
    || API_BASENAME.test(ctx.basename)
    || /\.dto\./i.test(ctx.basename);
}

const CONFIG_SEGMENTS: ReadonlySet<string> = new Set(['config', 'settings']);

const CONFIG_EXACT: ReadonlySet<string> = new Set([
  '.editorconfig', '.gitignore', '.gitattributes', '.prettierignore',
  '.eslintignore', '.npmrc', '.nvmrc', '.env', '.env.example', '.env.sample',
]);

const CONFIG_BASENAME = /^((tsconfig)|(\.eslintrc)|(\.prettierrc)|(\.babelrc))/i;

const CONFIG_TOOL_PREFIX = /^(vitest|jest|eslint|prettier|babel|webpack|rollup|vite|playwright|tailwind|postcss)\.config\./i;

const CONFIG_DOTTED = /\.config\./i;

const TEST_SEGMENTS: ReadonlySet<string> = new Set(['test', 'tests', 'spec', 'specs', '__tests__']);

const TEST_BASENAME = /(^|[._-])(test|spec)([._-]|$)/i;

const DOCUMENTATION_SEGMENTS: ReadonlySet<string> = new Set(['docs', 'documentation']);

const DOCUMENTATION_BASENAME = /^(README|CHANGELOG|LICENSE|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|NOTICE|AUTHORS)(\.|$)/i;

const SECURITY_SEGMENTS: ReadonlySet<string> = new Set([
  'security', 'auth', 'oauth', 'sessions', 'credentials', 'secrets', 'private',
]);

const SECURITY_BASENAME = /(^|[._-])(api-?key|password|passwd|secret|credential|token|.pem|.key)([._-]|$)/i;

function isGenerated(ctx: RepositoryPathContext): boolean {
  return ctx.segments.some((segment) => defaultIgnoreRules.dirNames.has(segment))
    || ctx.extension === '.map'
    || /\.min\.(js|css)$/.test(ctx.basename);
}

function isConfig(ctx: RepositoryPathContext): boolean {
  return ctx.segments.some((segment) => CONFIG_SEGMENTS.has(segment))
    || CONFIG_EXACT.has(ctx.basename)
    || CONFIG_BASENAME.test(ctx.basename)
    || CONFIG_TOOL_PREFIX.test(ctx.basename)
    || CONFIG_DOTTED.test(ctx.basename)
    || ctx.extension === '.ini';
}

function isTest(ctx: RepositoryPathContext): boolean {
  return TEST_BASENAME.test(ctx.basename)
    || ctx.segments.some((segment) => TEST_SEGMENTS.has(segment));
}

function isDocumentation(ctx: RepositoryPathContext): boolean {
  return ctx.extension === '.md' || ctx.extension === '.mdx'
    || ctx.segments.some((segment) => DOCUMENTATION_SEGMENTS.has(segment))
    || DOCUMENTATION_BASENAME.test(ctx.basename);
}

function isSource(ctx: RepositoryPathContext): boolean {
  return CODE_EXTENSIONS.includes(ctx.extension);
}

/**
 * Category precedence (first match wins):
 * dependency → migration → schema → database → persistence → ci → cli → api
 * → generated → config → test → documentation → source → unknown.
 */
const CATEGORY_RULES: ReadonlyArray<{
  category: ChangeFileCategory;
  matches: (ctx: RepositoryPathContext) => boolean;
}> = [
  { category: 'dependency', matches: isDependency },
  { category: 'migration', matches: isMigration },
  { category: 'schema', matches: isSchema },
  { category: 'database', matches: isDatabase },
  { category: 'persistence', matches: isPersistence },
  { category: 'ci', matches: isCi },
  { category: 'cli', matches: isCli },
  { category: 'api', matches: isApi },
  { category: 'generated', matches: isGenerated },
  { category: 'config', matches: isConfig },
  { category: 'test', matches: isTest },
  { category: 'documentation', matches: isDocumentation },
  { category: 'source', matches: isSource },
];

export function classifyChangeFile(normalizedPath: string): ChangeFileCategory {
  const ctx = describeRepositoryPath(normalizedPath);
  for (const rule of CATEGORY_RULES) {
    if (rule.matches(ctx)) return rule.category;
  }
  return 'unknown';
}

/**
 * Deterministic path grouping. This is ONLY path grouping; it does not infer
 * workspace/package semantics (see inspect/architecture for manifest parsing).
 *
 * - `src/<area>/<subsystem>/...` → first 3 segments (`src/core/repository`)
 * - `packages/<name>/...` → first 2 segments
 * - `apps/<name>/...` → first 2 segments
 * - otherwise the first 2 segments where available
 * - a root-level file keeps its normalized filename as its grouping
 */
export function deriveSubsystem(normalizedPath: string): string {
  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.length === 0) return '';
  const first = segments[0];
  const second = segments[1];
  const third = segments[2];

  if (first === 'src') {
    if (third !== undefined) return `${first}/${second}/${third}`;
    return first;
  }
  if ((first === 'packages' || first === 'apps') && second !== undefined) {
    return `${first}/${second}`;
  }
  if (second !== undefined) return `${first}/${second}`;
  return first;
}

function isSecuritySensitivePath(ctx: RepositoryPathContext): boolean {
  return ctx.segments.some((segment) => SECURITY_SEGMENTS.has(segment))
    || SECURITY_BASENAME.test(ctx.basename)
    || ctx.basename === '.env'
    || (ctx.basename.startsWith('.env.')
      && !ctx.basename.endsWith('.example')
      && !ctx.basename.endsWith('.sample'));
}

/**
 * Derives deterministic change signals from classified records and repository
 * status. `apiOrInterfaceChanges` and `securitySensitivePaths` are explicitly
 * path/name heuristics — never semantic or AST-level understanding.
 */
export function deriveChangeSignals(
  files: readonly ChangeFileRecord[],
  status: RepositoryStatus,
): ChangeSignals {
  const categories = new Set<ChangeFileCategory>();
  const securitySensitivePaths: string[] = [];
  for (const file of files) {
    categories.add(file.category);
    if (isSecuritySensitivePath(describeRepositoryPath(file.path))) {
      securitySensitivePaths.push(file.path);
    }
  }
  securitySensitivePaths.sort();

  const testChanges = categories.has('test');
  const testOnlyChange = files.length > 0 && files.every((file) => file.category === 'test');
  const deletedSourceFiles = files
    .filter((file) => file.status === 'deleted' && file.category === 'source')
    .map((file) => file.path)
    .sort();

  return {
    dependencyChanges: categories.has('dependency'),
    packageMetadataChanges: files.some((file) =>
      PACKAGE_METADATA_MANIFESTS.has(describeRepositoryPath(file.path).basename)),
    schemaOrMigrationChanges: categories.has('schema') || categories.has('migration'),
    persistenceOrStorageChanges: categories.has('database') || categories.has('persistence'),
    cliSurfaceChanges: categories.has('cli'),
    apiOrInterfaceChanges: categories.has('api'),
    testChanges,
    configurationChanges: categories.has('config'),
    documentationChanges: categories.has('documentation'),
    generatedOrBuildOutputChanges: categories.has('generated'),
    securitySensitivePaths,
    sourceCodeChanges: categories.has('source'),
    testOnlyChange,
    deletedSourceFiles,
    unstagedChangesPresent: hasWorkingTreeChanges(status) || status.untracked.length > 0,
  };
}

/**
 * Working-tree (unstaged) changes. Deliberately derived from per-entry
 * working-tree codes rather than `status.modified`, which simple-git populates
 * with changes staged to the index as well (`M`/` ` counts as modified there).
 * Untracked files are always unstaged.
 */
function hasWorkingTreeChanges(status: RepositoryStatus): boolean {
  return status.entries.some((entry) => {
    const workingTree = entry.workingTree.trim();
    return workingTree !== '' && workingTree !== '?';
  });
}

export function createEmptyChangeSignals(): ChangeSignals {
  return {
    dependencyChanges: false,
    packageMetadataChanges: false,
    schemaOrMigrationChanges: false,
    persistenceOrStorageChanges: false,
    cliSurfaceChanges: false,
    apiOrInterfaceChanges: false,
    testChanges: false,
    configurationChanges: false,
    documentationChanges: false,
    generatedOrBuildOutputChanges: false,
    securitySensitivePaths: [],
    sourceCodeChanges: false,
    testOnlyChange: false,
    deletedSourceFiles: [],
    unstagedChangesPresent: false,
  };
}

/**
 * Deterministic risk/complexity tier. Derived from structural signals only.
 * This is a conservative proxy for impact; it never claims semantic intent.
 */
export function classifyRisk(
  files: readonly ChangeFileRecord[],
  signals: ChangeSignals,
): { tier: ChangeRiskTier; tierReasons: string[] } {
  const reasons: string[] = [];
  const totalChanges = files.reduce((sum, file) => sum + file.insertions + file.deletions, 0);

  if (signals.schemaOrMigrationChanges) reasons.push('schema/migration files changed');
  if (signals.persistenceOrStorageChanges) reasons.push('persistence/storage files changed');
  if (signals.dependencyChanges) reasons.push('dependency files changed');
  if (signals.apiOrInterfaceChanges) reasons.push('api/interface-path files changed');
  if (signals.cliSurfaceChanges) reasons.push('cli surface files changed');
  if (signals.securitySensitivePaths.length > 0) reasons.push('security-sensitive paths changed');
  if (signals.deletedSourceFiles.length > 0) reasons.push('source files deleted');
  if (files.length > HIGH_THRESHOLD_FILES) reasons.push(`more than ${HIGH_THRESHOLD_FILES} files changed`);
  if (totalChanges > HIGH_THRESHOLD_CHANGES) reasons.push(`more than ${HIGH_THRESHOLD_CHANGES} line changes`);

  if (reasons.length > 0) return { tier: 'high', tierReasons: reasons };

  const moderateReasons: string[] = [];
  if (signals.testChanges) moderateReasons.push('test files changed');
  if (signals.sourceCodeChanges) moderateReasons.push('source files changed');
  if (signals.configurationChanges) moderateReasons.push('configuration files changed');
  if (files.length > MODERATE_THRESHOLD_FILES) moderateReasons.push(`more than ${MODERATE_THRESHOLD_FILES} files changed`);
  if (totalChanges > MODERATE_THRESHOLD_CHANGES) moderateReasons.push(`more than ${MODERATE_THRESHOLD_CHANGES} line changes`);

  if (moderateReasons.length > 0) return { tier: 'moderate', tierReasons: moderateReasons };

  return files.length === 0
    ? { tier: 'trivial', tierReasons: ['no staged changes'] }
    : { tier: 'trivial', tierReasons: ['small change without source, test, or configuration impact'] };
}