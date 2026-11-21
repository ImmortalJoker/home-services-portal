import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isScalar, parseDocument, visit } from 'yaml';

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

function assertWorkflowActionPins(source: string) {
  const document = parseDocument(source);
  expect(document.errors).toEqual([]);

  let actionCount = 0;
  visit(document, {
    Pair(_, { key, value }) {
      if (!isScalar(key) || key.value !== 'uses') return;

      actionCount++;
      expect(isScalar(value) && typeof value.value === 'string' ? value.value : '')
        .toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);

      const valueEnd = isScalar(value) ? value.range?.[1] : undefined;
      const lineSuffix = valueEnd === undefined ? '' : source.slice(valueEnd).split(/\r?\n/, 1)[0];
      expect(lineSuffix).toMatch(/^[ \t]+#[ \t]*v\d+\.\d+\.\d+[ \t]*$/);
    },
  });
  expect(actionCount).toBeGreaterThan(0);
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

  it('rejects an unpinned action with a quoted uses key', () => {
    const quotedKeyWorkflow = workflow.replace(
      /- uses: actions\/setup-node@[^\r\n]+/,
      '- "uses": actions/setup-node@v4 # v4.0.0',
    );
    expect(quotedKeyWorkflow).not.toBe(workflow);
    expect(() => assertWorkflowActionPins(quotedKeyWorkflow)).toThrow(/actions\/setup-node@v4/);
  });

  it('pins every third-party action to a full commit SHA with a version comment', () => {
    assertWorkflowActionPins(workflow);
  });
});
