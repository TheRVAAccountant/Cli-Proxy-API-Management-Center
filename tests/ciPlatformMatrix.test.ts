import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

type WorkflowStep = { run?: string; uses?: string };
type Workflow = {
  jobs: Record<
    string,
    {
      'runs-on': string;
      strategy?: { 'fail-fast'?: boolean; matrix?: { os?: string[] } };
      steps: WorkflowStep[];
    }
  >;
};

const workflow = parse(
  readFileSync(resolve(import.meta.dir, '../.github/workflows/ci.yml'), 'utf8')
) as Workflow;
const verify = workflow.jobs.verify;

describe('CI platform matrix', () => {
  test('verifies on Linux amd64 and macOS', () => {
    expect(verify['runs-on']).toBe('${{ matrix.os }}');
    expect(verify.strategy?.matrix?.os).toEqual(['ubuntu-latest', 'macos-latest']);
  });

  test('reports every platform instead of cancelling on the first failure', () => {
    expect(verify.strategy?.['fail-fast']).toBe(false);
  });

  test('installs from the lockfile and runs the full verify gate on each platform', () => {
    const commands = verify.steps.map((step) => step.run).filter(Boolean);
    expect(commands).toContain('bun install --frozen-lockfile');
    expect(commands).toContain('bun run verify');
  });
});
