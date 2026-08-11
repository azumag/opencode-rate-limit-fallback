import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('npm publish workflow', () => {
  const workflow = readFileSync(
    join(process.cwd(), '.github', 'workflows', 'npm-publish.yml'),
    'utf-8',
  );
  const ciWorkflow = readFileSync(
    join(process.cwd(), '.github', 'workflows', 'ci.yml'),
    'utf-8',
  );

  it('allows only successful main pushes from this repository', () => {
    expect(workflow.match(/github\.event\.workflow_run\.conclusion == 'success'/g)).toHaveLength(2);
    expect(workflow.match(/github\.event\.workflow_run\.event == 'push'/g)).toHaveLength(2);
    expect(workflow.match(/github\.event\.workflow_run\.head_branch == 'main'/g)).toHaveLength(2);
    expect(workflow.match(
      /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/g,
    )).toHaveLength(2);
  });

  it('uses the triggering CI run SHA and artifact in the publish job', () => {
    expect(workflow.match(/ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/g)).toHaveLength(2);
    expect(workflow).toContain('run-id: ${{ github.event.workflow_run.id }}');
    expect(workflow).toContain('github-token: ${{ github.token }}');
    expect(workflow).toContain('repository: ${{ github.repository }}');
  });

  it('pins every action to an immutable commit and uses the official artifact action', () => {
    const actionRefs = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)].map((match) => match[1]);

    expect(actionRefs).toHaveLength(4);
    expect(actionRefs.every((ref) => /@[0-9a-f]{40}$/.test(ref))).toBe(true);
    expect(actionRefs).toContain(
      'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
    );
    expect(workflow).not.toContain('dawidd6/action-download-artifact');
  });

  it('publishes with OIDC instead of a long-lived npm token', () => {
    const checkVersionJob = workflow.slice(
      workflow.indexOf('  check-version:'),
      workflow.indexOf('  publish:'),
    );
    const publishJob = workflow.slice(workflow.indexOf('  publish:'));

    expect(workflow).toContain('id-token: write');
    expect(checkVersionJob).not.toContain('id-token: write');
    expect(publishJob).toContain('id-token: write');
    expect(workflow).toContain("node-version: '24'");
    expect(workflow).toContain('npm install --global npm@11.19.0 --ignore-scripts');
    expect(workflow).not.toContain('NODE_AUTH_TOKEN');
    expect(workflow).not.toContain('secrets.NPM_TOKEN');
  });

  it('uses Node 24 and immutable action commits in CI', () => {
    const actionRefs = [...ciWorkflow.matchAll(/uses:\s+([^\s#]+)/g)].map((match) => match[1]);

    expect(ciWorkflow).toContain("node-version: '24'");
    expect(actionRefs).toHaveLength(3);
    expect(actionRefs.every((ref) => /@[0-9a-f]{40}$/.test(ref))).toBe(true);
    expect(actionRefs).toContain(
      'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    );
  });
});
