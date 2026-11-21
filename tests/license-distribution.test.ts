import { execFileSync } from 'node:child_process';
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
