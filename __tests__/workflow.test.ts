import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('npm publish workflow', () => {
  const workflow = readFileSync(
    join(process.cwd(), '.github', 'workflows', 'npm-publish.yml'),
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
      'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
    );
    expect(workflow).not.toContain('dawidd6/action-download-artifact');
  });
});
