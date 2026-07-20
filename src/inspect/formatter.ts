import type { RepositoryProfile } from './profile';

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

