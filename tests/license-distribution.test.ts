import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const fonts = ['OFL-DM-Mono.txt', 'OFL-DM-Sans.txt', 'OFL-Space-Grotesk.txt'];
const notices = [
  ['LICENSE', 'LICENSE.txt'],
  ['NOTICE', 'NOTICE.txt'],
  ...fonts.map((font) => [`src/assets/fonts/${font}`, `licenses/${font}`]),
];

describe('distributed license notices', () => {
  it('keeps all bundled font notices and the installed React runtime license covered', () => {
    expect(readdirSync(resolve(root, 'src/assets/fonts')).filter((name) => name.startsWith('OFL-')).sort())
      .toEqual([...fonts].sort());
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
    for (const name of ['react', 'react-dom', 'scheduler']) {
      expect(normalize(read('NOTICE'))).toContain(normalize(read(`node_modules/${name}/LICENSE`)));
    }
  });

  it('records Fontsource package provenance and SHA-256 digests for every bundled WOFF2 file', () => {
    const notice = read('NOTICE');
    const woff2 = readdirSync(resolve(root, 'src/assets/fonts')).filter((name) => name.endsWith('.woff2'));
    expect(woff2).toHaveLength(8);
    for (const pkg of ['@fontsource/dm-mono 5.3.0', '@fontsource-variable/dm-sans 5.3.0', '@fontsource-variable/space-grotesk 5.3.0']) {
      expect(notice).toContain(pkg);
    }
    for (const name of woff2) {
      const digest = createHash('sha256').update(readFileSync(resolve(root, 'src/assets/fonts', name))).digest('hex');
      expect(notice).toMatch(new RegExp(`${name}\\n\\s+${digest}\\n`));
    }
  });

  for (const [name, base, demo] of [
    ['Pages', '/home-services-portal/', 'true'],
    ['Authentik', '/', 'false'],
  ]) {
    it(`includes complete, current notices in the ${name} static build`, () => {
      const outDir = mkdtempSync(join(tmpdir(), 'portal-licenses-'));
      try {
        execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', outDir], {
          cwd: root,
          env: { ...process.env, VITE_BASE_PATH: base, VITE_PORTAL_PUBLIC_DEMO: demo },
          stdio: 'pipe',
        });
        for (const [source, destination] of notices) {
          const expected = read(source);
          expect(readFileSync(join(outDir, destination), 'utf8')).toBe(expected);
          expect(read(`public/${destination}`)).toBe(expected);
        }
      } finally {
        rmSync(outDir, { recursive: true, force: true });
      }
    }, 60_000);
  }

  it('copies the public notices through the Docker build into the served runtime directory', () => {
    const dockerfile = read('deploy/authentik/portal/Dockerfile');
    expect(dockerfile).toMatch(/^COPY public \.\/public$/m);
    expect(dockerfile).toMatch(/^COPY --from=build --chown=node:node \/src\/dist \.\/dist$/m);
    expect(dockerfile).toContain('PORTAL_DIST_DIR=/app/dist');
    expect(read('.dockerignore').split(/\r?\n/)).not.toContain('public');
  });
});
