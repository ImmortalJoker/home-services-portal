import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

function assertWorkflowActionPins(source: string) {
  const actionLines = source.split(/\r?\n/).filter((line) => /^\s*(?:-\s*)?uses\s*:/.test(line));
  const uses = [...source.matchAll(/^\s*(?:-\s*)?uses\s*:\s*(\S+)(?:\s+#\s*(.*))?\s*$/gm)];
  expect(uses).toHaveLength(actionLines.length);
  expect(uses.length).toBeGreaterThan(0);
  for (const [, ref, version] of uses) {
    expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    expect(version).toMatch(/^v\d+\.\d+\.\d+$/);
  }
}

describe('GitHub Actions permissions', () => {
  it('keeps Pages deployment permissions out of the verification job', () => {
    const workflowPermissions = workflow.match(/^permissions:\n((?:  .*\n)+)/m)?.[1] ?? '';
    const verifyJob = workflow.split('  verify:\n')[1]?.split('\n  deploy:\n')[0] ?? '';
    const deployJob = workflow.split('  deploy:\n')[1] ?? '';
    const deployPermissions = deployJob.match(/^    permissions:\n((?:      .*\n)+)/m)?.[1] ?? '';

    expect(workflowPermissions).toContain('contents: read');
    expect(workflowPermissions).not.toContain('pages: write');
    expect(workflowPermissions).not.toContain('id-token: write');
    expect(verifyJob).not.toContain('permissions:');
    expect(deployPermissions).toContain('pages: write');
    expect(deployPermissions).toContain('id-token: write');
  });

  it('rejects an unpinned action even when it has a non-version comment', () => {
    const unpinnedWorkflow = workflow.replace(
      /actions\/setup-node@[0-9a-f]{40}\s+#\s*v\d+\.\d+\.\d+/,
      'actions/setup-node@v4 # Node 22',
    );
    expect(unpinnedWorkflow).not.toBe(workflow);
    expect(() => assertWorkflowActionPins(unpinnedWorkflow)).toThrow();
  });

  it('pins every third-party action to a full commit SHA with a version comment', () => {
    assertWorkflowActionPins(workflow);
  });
});
