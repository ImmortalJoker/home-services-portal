import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

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
});
