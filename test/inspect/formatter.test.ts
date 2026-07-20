import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { clearDependencyCache } from '../../src/inspect/dependencies';
import { inspectRepository } from '../../src/inspect/profile';
import { formatRepositoryProfile } from '../../src/inspect/formatter';
import { inspectCommand } from '../../src/commands/inspect';

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gritch-format-'));
}

function writeFile(root: string, rel: string, content: string) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function writePkg(root: string, pkg: any) {
  writeFile(root, 'package.json', JSON.stringify(pkg, null, 2));
}

describe('inspect formatter', () => {
  beforeEach(() => {
    clearDependencyCache();
  });

  it('formats an empty repository deterministically (all sections show Not detected)', () => {
    const root = makeRoot();
    const profile = inspectRepository(root);
    const out = formatRepositoryProfile(profile);

    // Exact string assertion.
    expect(out).toBe(
      [
        'Repository',
        `  Root: ${path.resolve(root)}`,
        '  Evidence: Not detected',
        '  Inventory:',
        '    Files: 0',
        '    TotalSizeBytes: 0',
        'Architecture',
        '  Not detected',
        '  Confidence: 0',
        '  Evidence:',
        '    - Not detected',
        'Languages',
        '  Not detected',
        '  Confidence: 0',
        '  Evidence:',
        '    - Not detected',
        'Frameworks',
        '  Not detected',
        '  Confidence: 0',
        '  Evidence:',
        '    - Not detected',
        'Build Tools',
        '  Not detected',
        '  Confidence: 0',
        '  Evidence:',
        '    - Not detected',
        'Package Manager',
        '  Not detected',
        '  Confidence: 0',
        '  Evidence:',
        '    - Not detected',
        'Testing',
        '  Not detected',
        '  Confidence: 0',
        '  Evidence:',
        '    - Not detected',
        'Linting',
        '  Not detected',
        '  Confidence: 0',
        '  Evidence:',
        '    - Not detected',
        'Formatting',
        '  Not detected',
        '  Confidence: 0',
        '  Evidence:',
        '    - Not detected',
        'Database',
        '  Not detected',
        '  Confidence: 0',
        '  Evidence:',
        '    - Not detected',
        'ORM',
        '  Not detected',
        '  Confidence: 0',
        '  Evidence:',
        '    - Not detected',
        'Dependencies',
        '  Not detected',
        '  Confidence: 0',
        '  Evidence:',
        '    - Not detected',
      ].join('\n'),
    );
  });

  it('formats a representative repository and is stable (formatter output matches exact string and CLI stdout)', () => {
    const root = makeRoot();

    writePkg(root, {
      name: 'x',
      version: '0.0.0',
      packageManager: 'pnpm@9.0.0',
      dependencies: { react: '^18.0.0', vite: '^5.0.0', prisma: '^5.0.0', '@prisma/client': '^5.0.0' },
      devDependencies: {
        typescript: '^5.0.0',
        vitest: '^1.0.0',
        prettier: '^3.0.0',
        eslint: '^9.0.0',
        '@biomejs/biome': '^1.0.0',
      },
      scripts: {
        test: 'vitest',
        dev: 'vite',
        lint: 'eslint .',
        format: 'prettier --write .',
      },
    });

    writeFile(root, 'tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2020' } }));
    writeFile(root, 'vite.config.ts', 'export default {}');
    writeFile(root, 'src/main.tsx', 'export {}');
    writeFile(root, 'src/App.tsx', 'export {}');
    writeFile(root, 'vitest.config.ts', 'export default {}');
    writeFile(root, 'eslint.config.js', 'export default []');
    writeFile(root, '.prettierrc', '{}');
    writeFile(root, 'prisma/schema.prisma', 'model User { id Int }');

    const profile = inspectRepository(root);
    const out1 = formatRepositoryProfile(profile);
    const out2 = formatRepositoryProfile(profile);
    expect(out1).toBe(out2);

    // CLI integration: capture stdout
    const originalLog = console.log;
    const logs: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console as any).log = (msg?: any) => {
      logs.push(String(msg));
    };

    try {
      inspectCommand(root);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (console as any).log = originalLog;
    }

    expect(logs.join('\n')).toBe(out1);

    // Exact snapshot for representative repo.
    expect(out1).toBe(
      [
        'Repository',
        `  Root: ${path.resolve(root)}`,
        '  Evidence: Not detected',
        '  Inventory:',
        // We don't assert exact bytes; inventory.files includes all created files + package.json.
        // Keep deterministic by relying on actual file count.
        `    Files: ${profile.inventory.fileCount}`,
        `    TotalSizeBytes: ${profile.inventory.totalSizeBytes}`,
        'Architecture',
        '  Not detected',
        '  Confidence: 0',
        '  Evidence:',
        '    - Not detected',
        'Languages',
        '  Primary: TypeScript',
        '  Secondary: JavaScript',
        '  Confidence: 0.85',
        '  Evidence:',
        '    - JavaScript<- eslint.config.js',
        `    - TypeScript<- ${path.join('src', 'App.tsx')}`,
        `    - TypeScript<- ${path.join('src', 'main.tsx')}`,
        '    - TypeScript<- vite.config.ts',
        '    - TypeScript<- vitest.config.ts',
        '    - manifest hint: TypeScript (+0.4)',
        'Frameworks',
        '  Primary: React',
        '  Secondary: Vue',
        '  Confidence: 0.80',
        '  Evidence:',
        '    - package.json dep: react',
        '    - entry file: src/main.tsx',
        '    - entry file: src/App.tsx',
        '    - config file: vite.config.ts',
        'Build Tools',
        '  Primary: Vite',
        '  Confidence: 1.00',
        '  Evidence:',
        '    - package.json dep: vite',
        '    - script: test contains vite',
        '    - script: dev contains vite',
        '    - config file: vite.config.ts',
        'Package Manager',
        '  Primary: pnpm',
        '  Confidence: 1.00',
        '  Evidence:',
        '    - package.json packageManager: pnpm@9.0.0',
        'Testing',
        '  Primary: Vitest',
        '  Confidence: 1.00',
        '  Evidence:',
        '    - package.json dep: vitest',
        '    - config file: vitest.config.ts',
        'Linting',
        '  Primary: ESLint',
        '  Confidence: 0.66',
        '  Evidence:',
        '    - package.json dep: eslint',
        '    - config file: eslint.config.js',
        '    - package.json dep: @biomejs/biome',
        'Formatting',
        '  Primary: Prettier',
        '  Confidence: 0.65',
        '  Evidence:',
        '    - package.json dep: prettier',
        '    - config file: .prettierrc',
        '    - package.json dep: @biomejs/biome',
        'Database',
        '  Not detected',
        '  Confidence: 0',
        '  Evidence:',
        '    - Not detected',
        'ORM',
        '  Primary: Prisma',
        '  Confidence: 1.00',
        '  Evidence:',
        '    - package.json dep: prisma',
        '    - package.json dep: @prisma/client',
        '    - config file: prisma/schema.prisma',
        'Dependencies',
        '  Primary: @biomejs/biome, @prisma/client, eslint, prettier, prisma, react, typescript, vite, vitest',
        '  Confidence: 1.00',
        '  Evidence:',
        '    - Indexed 9 dependencies',
      ].join('\n'),
    );
  });
});

