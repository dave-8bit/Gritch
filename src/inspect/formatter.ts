import type { RepositoryProfile } from './profile';
import type { ArchitectureDetectionResult } from './architecture';
import type { DependencyIndex } from './dependencies';
import type { PackageManagerDetectionResult } from './packageManager';
import type { RepositoryTree, RepositoryTreeNode } from './tree';
import type { RepositoryCommit } from '../utils/git';

function formatConfidence(confidence: number): string {
  if (!Number.isFinite(confidence) || confidence <= 0) return '0';
  // Deterministic: 2 decimals, no locale.
  return confidence.toFixed(2);
}

function formatEvidence(evidence: string[] | undefined): string {
  const lines = (evidence ?? []).filter(Boolean).map((e) => `    - ${e}`);
  if (lines.length === 0) return `  Evidence:\n    - Not detected`;
  return `  Evidence:\n${lines.join('\n')}`;
}

function formatTreeNode(node: RepositoryTreeNode, depth: number, maxDepth: number, prefix: string, isLast: boolean): string[] {
  const marker = isLast ? '└── ' : '├── ';
  const lines = [`${prefix}${marker}${node.kind === 'directory' ? `${node.name}/` : node.name}`];
  if (node.kind !== 'directory' || depth >= maxDepth) {
    if (node.kind === 'directory' && node.children.length > 0 && depth >= maxDepth) {
      lines.push(`${prefix}${isLast ? '    ' : '│   '}└── ...`);
    }
    return lines;
  }

  const childPrefix = `${prefix}${isLast ? '    ' : '│   '}`;
  node.children.forEach((child, index) => {
    lines.push(...formatTreeNode(child, depth + 1, maxDepth, childPrefix, index === node.children.length - 1));
  });
  return lines;
}

export function formatRepositoryTree(root: string, tree: RepositoryTree, displayDepth: number): string {
  const depth = Math.max(0, Math.floor(displayDepth));
  const lines = [`Repository: ${root}`, '', 'Tree:'];
  if (tree.children.length === 0 || depth === 0) {
    lines.push('(empty)');
  } else {
    tree.children.forEach((node, index) => {
      lines.push(...formatTreeNode(node, 1, depth, '', index === tree.children.length - 1));
    });
  }
  return lines.join('\n');
}

function formatDetectorSection(opts: {
  title: string;
  notDetectedEvidenceLine?: string;
  primary?: string | undefined;
  secondary?: string[] | undefined;
  confidence?: number;
  evidence?: string[];
}): string {
  const {
    title,
    notDetectedEvidenceLine = 'Not detected',
    primary,
    secondary,
    confidence = 0,
    evidence,
  } = opts;

  const hasPrimary = primary !== undefined;
  const lines: string[] = [];
  lines.push(title);

  if (!hasPrimary) {
    lines.push('  Not detected');
    lines.push(`  Confidence: 0`);
    if (evidence && evidence.length > 0) {
      const evLines = evidence.filter(Boolean).map((e) => `    - ${e}`);
      lines.push('  Evidence:');
      if (evLines.length > 0) lines.push(...evLines);
      else lines.push(`    - ${notDetectedEvidenceLine}`);
    } else {
      lines.push('  Evidence:');
      lines.push(`    - ${notDetectedEvidenceLine}`);
    }
    return lines.join('\n');
  }

  lines.push(`  Primary: ${primary}`);

  const sec = secondary ?? [];
  if (sec.length > 0) lines.push(`  Secondary: ${sec.join(', ')}`);

  lines.push(`  Confidence: ${formatConfidence(confidence)}`);

  const ev = evidence ?? [];
  if (ev.length > 0) {
    lines.push('  Evidence:');
    lines.push(...ev.filter(Boolean).map((e) => `    - ${e}`));
  } else {
    lines.push('  Evidence:');
    lines.push(`    - ${notDetectedEvidenceLine}`);
  }

  return lines.join('\n');
}

export function formatRepositoryProfile(profile: RepositoryProfile): string {
  const repoEvidenceLine = profile.rootEvidence ? `  Evidence: ${profile.rootEvidence}` : '  Evidence: Not detected';

  const languagesSection = formatDetectorSection({
    title: 'Languages',
    primary: profile.languages.confidence === 0 ? undefined : profile.languages.primary,
    secondary: profile.languages.secondary,
    confidence: profile.languages.confidence,
    evidence: profile.languages.confidence === 0 ? undefined : profile.languages.evidence,
    notDetectedEvidenceLine: 'Not detected',
  });

  const frameworksPrimary = profile.frameworks.confidence === 0 ? undefined : profile.frameworks.primary;
  const frameworksSection = formatDetectorSection({
    title: 'Frameworks',
    primary: frameworksPrimary,
    secondary: profile.frameworks.secondary,
    confidence: profile.frameworks.confidence,
    evidence: profile.frameworks.confidence === 0 ? undefined : profile.frameworks.evidence,
  });

  const buildToolsSection = formatDetectorSection({
    title: 'Build Tools',
    primary: profile.buildTools.primary,
    secondary: profile.buildTools.secondary,
    confidence: profile.buildTools.confidence,
    evidence: profile.buildTools.primary ? profile.buildTools.evidence : undefined,
  });

  const packageManagerSection = formatDetectorSection({
    title: 'Package Manager',
    primary: profile.packageManager.detected === 'unknown' ? undefined : profile.packageManager.detected,
    secondary: [],
    confidence: profile.packageManager.confidence,
    evidence: profile.packageManager.detected === 'unknown' ? undefined : profile.packageManager.evidence,
  });

  const testingSection = formatDetectorSection({
    title: 'Testing',
    primary: profile.testing.primary,
    secondary: profile.testing.secondary,
    confidence: profile.testing.confidence,
    evidence: profile.testing.primary ? profile.testing.evidence : undefined,
  });

  const lintingSection = formatDetectorSection({
    title: 'Linting',
    primary: profile.linting.primary,
    secondary: profile.linting.secondary,
    confidence: profile.linting.confidence,
    evidence: profile.linting.primary ? profile.linting.evidence : undefined,
  });

  const formattingSection = formatDetectorSection({
    title: 'Formatting',
    primary: profile.formatting.primary,
    secondary: profile.formatting.secondary,
    confidence: profile.formatting.confidence,
    evidence: profile.formatting.primary ? profile.formatting.evidence : undefined,
  });

  const databaseSection = formatDetectorSection({
    title: 'Database',
    primary: profile.database.primary,
    secondary: profile.database.secondary,
    confidence: profile.database.confidence,
    evidence: profile.database.primary ? profile.database.evidence : undefined,
  });

  const ormSection = formatDetectorSection({
    title: 'ORM',
    primary: profile.orm.primary,
    secondary: profile.orm.secondary,
    confidence: profile.orm.confidence,
    evidence: profile.orm.primary ? profile.orm.evidence : undefined,
  });

  const archMonorepo = profile.architecture.monorepo ? 'Monorepo' : 'Not monorepo';
  const architectureSection = formatDetectorSection({
    title: 'Architecture',
    primary: profile.architecture.confidence === 0 ? undefined : archMonorepo,
    secondary: [],
    confidence: profile.architecture.confidence,
    evidence: profile.architecture.confidence === 0 ? undefined : profile.architecture.evidence,
  });

  const dependenciesSection: string[] = [];
  dependenciesSection.push('Dependencies');
  const depsCount = profile.dependencies.all.size;
  if (depsCount === 0) {
    dependenciesSection.push('  Not detected');
    dependenciesSection.push('  Confidence: 0');
    dependenciesSection.push('  Evidence:');
    dependenciesSection.push('    - Not detected');
  } else {
    // Confidence not available for dependencies; use 1.00 for presence deterministically.
    dependenciesSection.push(`  Primary: ${Array.from(profile.dependencies.all).sort().join(', ')}`);
    dependenciesSection.push('  Confidence: 1.00');
    dependenciesSection.push('  Evidence:');
    dependenciesSection.push(`    - Indexed ${depsCount} dependencies`);
  }

  return [
    'Repository',
    `  Root: ${profile.root}`,
    repoEvidenceLine,
    '  Inventory:',
    `    Files: ${profile.inventory.fileCount}`,
    `    TotalSizeBytes: ${profile.inventory.totalSizeBytes}`,
    '',
    architectureSection,
    languagesSection,
    frameworksSection,
    buildToolsSection,
    packageManagerSection,
    testingSection,
    lintingSection,
    formattingSection,
    databaseSection,
    ormSection,
    dependenciesSection.join('\n'),
  ].filter(Boolean).join('\n');
}

function formatDoctorDetector(
  label: string,
  primary: string | undefined,
  secondary: string[],
  confidence: number,
  evidence: string[],
): string[] {
  const lines = [`  ${label}:`];
  if (primary === undefined) {
    lines.push('    Not detected');
  } else {
    lines.push(`    Primary: ${primary}`);
    if (secondary.length > 0) lines.push(`    Secondary: ${secondary.join(', ')}`);
  }
  lines.push(`    Confidence: ${formatConfidence(confidence)}`);
  lines.push('    Evidence:');
  const evidenceLines = evidence.filter(Boolean);
  lines.push(...(evidenceLines.length > 0 ? evidenceLines.map((item) => `      - ${item}`) : ['      - Not detected']));
  return lines;
}

export function formatDoctor(profile: RepositoryProfile): string {
  const runtimeDependencies = Object.keys(profile.dependencies.dependencies).sort();
  const developmentDependencies = Object.keys(profile.dependencies.devDependencies).sort();
  const allDependencies = Array.from(profile.dependencies.all).sort();
  const directories = Object.entries(profile.architecture.directories)
    .filter(([, present]) => present)
    .map(([directory]) => directory);

  const toolingLines = [
    'Tooling',
    ...formatDoctorDetector('Languages', profile.languages.confidence > 0 ? profile.languages.primary : undefined, profile.languages.secondary, profile.languages.confidence, profile.languages.evidence),
    ...formatDoctorDetector('Frameworks', profile.frameworks.confidence > 0 ? profile.frameworks.primary : undefined, profile.frameworks.secondary, profile.frameworks.confidence, profile.frameworks.evidence),
    ...formatDoctorDetector('Build Tools', profile.buildTools.primary, profile.buildTools.secondary, profile.buildTools.confidence, profile.buildTools.evidence),
    ...formatDoctorDetector('Package Manager', profile.packageManager.detected === 'unknown' ? undefined : profile.packageManager.detected, [], profile.packageManager.confidence, profile.packageManager.evidence),
    ...formatDoctorDetector('Testing', profile.testing.primary, profile.testing.secondary, profile.testing.confidence, profile.testing.evidence),
    ...formatDoctorDetector('Linting', profile.linting.primary, profile.linting.secondary, profile.linting.confidence, profile.linting.evidence),
    ...formatDoctorDetector('Formatting', profile.formatting.primary, profile.formatting.secondary, profile.formatting.confidence, profile.formatting.evidence),
    ...formatDoctorDetector('Database', profile.database.primary, profile.database.secondary, profile.database.confidence, profile.database.evidence),
    ...formatDoctorDetector('ORM', profile.orm.primary, profile.orm.secondary, profile.orm.confidence, profile.orm.evidence),
  ];

  const recommendationLines = profile.health.recommendations.length > 0
    ? profile.health.recommendations.map((recommendation) => `  - ${recommendation}`)
    : ['  None'];

  const dependencyLines = [
    'Dependencies',
    `  Runtime Count: ${runtimeDependencies.length}`,
    `  Development Count: ${developmentDependencies.length}`,
    `  Total Count: ${allDependencies.length}`,
    `  Package Manager: ${profile.packageManager.detected === 'unknown' ? 'Not detected' : profile.packageManager.detected}`,
    '  Runtime:',
    ...(runtimeDependencies.length > 0 ? runtimeDependencies.map((dependency) => `    - ${dependency}`) : ['    None']),
    '  Development:',
    ...(developmentDependencies.length > 0 ? developmentDependencies.map((dependency) => `    - ${dependency}`) : ['    None']),
  ];

  const evidenceLines = [
    'Evidence',
    `  Root: ${profile.rootEvidence ?? 'Not detected'}`,
    '  Health:',
    ...(profile.health.evidence.length > 0 ? profile.health.evidence.map((item) => `    - ${item}`) : ['    - Not detected']),
    '  Detectors:',
    ...[
      ...profile.languages.evidence,
      ...profile.frameworks.evidence,
      ...profile.buildTools.evidence,
      ...profile.packageManager.evidence,
      ...profile.testing.evidence,
      ...profile.linting.evidence,
      ...profile.formatting.evidence,
      ...profile.database.evidence,
      ...profile.orm.evidence,
      ...profile.architecture.evidence,
    ].filter(Boolean).map((item) => `    - ${item}`),
  ];

  return [
    'Repository',
    `  Root: ${profile.root}`,
    `  Root Evidence: ${profile.rootEvidence ?? 'Not detected'}`,
    '',
    'Health',
    `  Score: ${profile.health.score}`,
    `  Grade: ${profile.health.grade}`,
    `  Present: ${profile.health.present.length > 0 ? profile.health.present.join(', ') : 'None'}`,
    `  Missing: ${profile.health.missing.length > 0 ? profile.health.missing.join(', ') : 'None'}`,
    '',
    'Recommendations',
    ...recommendationLines,
    '',
    ...toolingLines,
    '',
    'Architecture',
    `  Monorepo: ${profile.architecture.monorepo ? 'Yes' : 'No'}`,
    `  Workspace Manager: ${profile.architecture.workspaceManager ?? 'Not detected'}`,
    `  Confidence: ${formatConfidence(profile.architecture.confidence)}`,
    `  Directories: ${directories.length > 0 ? directories.join(', ') : 'None'}`,
    '',
    ...dependencyLines,
    '',
    'Inventory',
    `  Files: ${profile.inventory.fileCount}`,
    `  Total Size Bytes: ${profile.inventory.totalSizeBytes}`,
    '',
    ...evidenceLines,
  ].join('\n');
}

export function formatArchitecture(architecture: ArchitectureDetectionResult): string {
  const lines = [
    'Architecture',
    `  Monorepo: ${architecture.monorepo ? 'Yes' : 'No'}`,
    `  Workspace Manager: ${architecture.workspaceManager ?? 'Not detected'}`,
    `  Confidence: ${formatConfidence(architecture.confidence)}`,
    '  Evidence:',
  ];

  if (architecture.evidence.length > 0) {
    lines.push(...architecture.evidence.filter(Boolean).map((evidence) => `    - ${evidence}`));
  } else {
    lines.push('    - Not detected');
  }

  const directories = Object.entries(architecture.directories)
    .filter(([, present]) => present)
    .map(([directory]) => directory);

  lines.push('  Detected Directories:');
  lines.push(directories.length > 0 ? `    ${directories.join(', ')}` : '    None');

  return lines.join('\n');
}

export function formatDependencies(
  dependencies: DependencyIndex,
  packageManager: PackageManagerDetectionResult,
): string {
  const runtime = Object.keys(dependencies.dependencies).sort();
  const development = Object.keys(dependencies.devDependencies).sort();
  const runtimeLines = runtime.length > 0
    ? runtime.map((dependency) => `    - ${dependency}`)
    : ['    None'];
  const developmentLines = development.length > 0
    ? development.map((dependency) => `    - ${dependency}`)
    : ['    None'];

  return [
    'Dependencies',
    `  Runtime Count: ${runtime.length}`,
    `  Development Count: ${development.length}`,
    `  Total Count: ${dependencies.all.size}`,
    `  Package Manager: ${packageManager.detected === 'unknown' ? 'Not detected' : packageManager.detected}`,
    '  Runtime:',
    ...runtimeLines,
    '  Development:',
    ...developmentLines,
  ].join('\n');
}

export function formatRepositoryStats(profile: RepositoryProfile): string {
  const languages = [profile.languages.primary, ...profile.languages.secondary].filter(Boolean);

  return [
    'Repository Statistics',
    `  Files: ${profile.inventory.fileCount}`,
    `  Total Size Bytes: ${profile.inventory.totalSizeBytes}`,
    `  Primary Language: ${profile.languages.confidence > 0 ? profile.languages.primary : 'Not detected'}`,
    `  Secondary Languages: ${languages.length > 1 ? languages.slice(1).join(', ') : 'None'}`,
    `  Language Confidence: ${formatConfidence(profile.languages.confidence)}`,
    `  Runtime Dependencies: ${Object.keys(profile.dependencies.dependencies).length}`,
    `  Development Dependencies: ${Object.keys(profile.dependencies.devDependencies).length}`,
    `  Total Dependencies: ${profile.dependencies.all.size}`,
    `  Architecture: ${profile.architecture.confidence > 0
      ? (profile.architecture.monorepo ? 'Monorepo' : 'Standard')
      : 'Not detected'}`,
    `  Framework: ${profile.frameworks.confidence > 0 ? profile.frameworks.primary : 'Not detected'}`,
    `  Build Tool: ${profile.buildTools.primary ?? 'Not detected'}`,
  ].join('\n');
}

export function formatRepositoryHistory(root: string, commits: readonly RepositoryCommit[]): string {
  const lines = [
    'Repository History',
    `  Root: ${root}`,
    `  Commits: ${commits.length}`,
    '',
  ];

  if (commits.length === 0) {
    lines.push('  (no commits)');
    return lines.join('\n');
  }

  for (const commit of commits) {
    lines.push(`  ${commit.hash.slice(0, 7)}  ${commit.date}  ${commit.author}`);
    lines.push(`    ${commit.subject}`);
  }

  return lines.join('\n');
}
