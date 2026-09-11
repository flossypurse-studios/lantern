/**
 * The verdict core is pure, so all of this runs with no repo and no report
 * file anywhere on disk.
 */
import { describe, it, expect } from 'vitest';
import { computeVerdicts, judgeClaim, orderForDisplay } from '../src/verdict.js';
import type {
  CaseStatus,
  Claim,
  NormalizedReport,
  ResolvedBlock,
} from '../src/types.js';

const REPO = '/repo';

function report(
  project: string,
  files: Record<string, CaseStatus[]>,
): NormalizedReport {
  return {
    project,
    format: 'vitest',
    source: `${project}.json`,
    files: Object.entries(files).map(([path, statuses]) => ({
      path,
      cases: statuses.map((status, i) => ({ name: `case ${i}`, status })),
    })),
  };
}

function reports(...rs: NormalizedReport[]): Map<string, NormalizedReport> {
  return new Map(rs.map((r) => [r.project, r]));
}

const testClaim = (file: string, project: string): Claim => ({
  kind: 'test',
  test: file,
  project,
  line: 1,
});

function block(loss: string, claims: Claim[], ok = true): ResolvedBlock {
  return {
    loss,
    line: 1,
    claims: claims.map((claim) => ({ claim, resolution: { ok } })),
  };
}

describe('judgeClaim — the six verdicts', () => {
  it('LIT when every case in the file passed', () => {
    const v = judgeClaim(
      testClaim('test/unit/a.test.ts', 'unit'),
      true,
      undefined,
      reports(report('unit', { '/ci/app/test/unit/a.test.ts': ['passed', 'passed'] })),
      REPO,
    );
    expect(v.verdict).toBe('LIT');
    expect(v.detail).toContain('2 of 2 cases passed');
  });

  it('SKIPPED when some cases are skipped, and says how many of how many', () => {
    const v = judgeClaim(
      testClaim('test/unit/a.test.ts', 'unit'),
      true,
      undefined,
      reports(
        report('unit', { '/ci/app/test/unit/a.test.ts': ['passed', 'skipped', 'skipped'] }),
      ),
      REPO,
    );
    expect(v.verdict).toBe('SKIPPED');
    expect(v.detail).toContain('2 of 3 cases did not run');
    expect(v.detail).toContain('2 skipped');
  });

  it('SKIPPED counts todo cases as not having run', () => {
    const v = judgeClaim(
      testClaim('test/unit/a.test.ts', 'unit'),
      true,
      undefined,
      reports(report('unit', { '/ci/app/test/unit/a.test.ts': ['passed', 'todo'] })),
      REPO,
    );
    expect(v.verdict).toBe('SKIPPED');
    expect(v.detail).toContain('1 todo');
  });

  it('SKIPPED when the whole file is gated off (the motivating case)', () => {
    const v = judgeClaim(
      testClaim('test/integration/erasure.test.ts', 'integration'),
      true,
      undefined,
      reports(
        report('integration', {
          '/ci/app/test/integration/erasure.test.ts': ['skipped', 'skipped'],
        }),
      ),
      REPO,
    );
    expect(v.verdict).toBe('SKIPPED');
    expect(v.detail).toContain('2 of 2');
  });

  it('FAILED outranks SKIPPED in the same file', () => {
    const v = judgeClaim(
      testClaim('test/unit/a.test.ts', 'unit'),
      true,
      undefined,
      reports(
        report('unit', { '/ci/app/test/unit/a.test.ts': ['failed', 'skipped', 'passed'] }),
      ),
      REPO,
    );
    expect(v.verdict).toBe('FAILED');
    expect(v.detail).toContain('1 of 3 cases failed');
  });

  it('NOT-RUN when a report exists for the project but omits the file', () => {
    const v = judgeClaim(
      testClaim('test/unit/a.test.ts', 'unit'),
      true,
      undefined,
      reports(report('unit', { '/ci/app/test/unit/other.test.ts': ['passed'] })),
      REPO,
    );
    expect(v.verdict).toBe('NOT-RUN');
    expect(v.detail).toContain('does not appear in it');
  });

  it('NOT-RUN when the file appears with no cases at all', () => {
    const v = judgeClaim(
      testClaim('test/unit/a.test.ts', 'unit'),
      true,
      undefined,
      reports(report('unit', { '/ci/app/test/unit/a.test.ts': [] })),
      REPO,
    );
    expect(v.verdict).toBe('NOT-RUN');
  });

  it('NO-REPORT when no report was supplied for the claim’s project', () => {
    const v = judgeClaim(
      testClaim('test/integration/erasure.test.ts', 'integration'),
      true,
      undefined,
      reports(report('unit', { '/ci/app/test/unit/a.test.ts': ['passed'] })),
      REPO,
    );
    expect(v.verdict).toBe('NO-REPORT');
    expect(v.detail).toContain('integration');
    expect(v.detail).toContain('nothing shows this test ever ran');
  });

  it('NO-REPORT when no reports were supplied at all', () => {
    const v = judgeClaim(
      testClaim('test/unit/a.test.ts', 'unit'),
      true,
      undefined,
      new Map(),
      REPO,
    );
    expect(v.verdict).toBe('NO-REPORT');
  });

  it('UNRESOLVED beats every report-based verdict', () => {
    const v = judgeClaim(
      testClaim('test/unit/gone.test.ts', 'unit'),
      false,
      'test file not found in the repo: test/unit/gone.test.ts',
      reports(report('unit', { '/ci/app/test/unit/gone.test.ts': ['passed'] })),
      REPO,
    );
    expect(v.verdict).toBe('UNRESOLVED');
  });

  it('a resolved non-test claim is LIT and needs no report', () => {
    for (const claim of [
      { kind: 'file', file: 'lib/a.ts', line: 1 },
      { kind: 'symbol', symbol: 'x', file: 'lib/a.ts', line: 1 },
      { kind: 'commit', commit: 'abc1234', line: 1 },
    ] satisfies Claim[]) {
      expect(judgeClaim(claim, true, 'ok', new Map(), REPO).verdict).toBe('LIT');
    }
  });

  it('an unresolved non-test claim is UNRESOLVED', () => {
    const v = judgeClaim(
      { kind: 'commit', commit: 'deadbee', line: 1 },
      false,
      'commit deadbee does not resolve in this repo',
      new Map(),
      REPO,
    );
    expect(v.verdict).toBe('UNRESOLVED');
    expect(v.detail).toContain('does not resolve');
  });
});

describe('per-loss roll-up', () => {
  it('LIT only when every claim is LIT', () => {
    const r = computeVerdicts({
      ledgerPath: 'l.md',
      repoRoot: REPO,
      losses: ['L1'],
      blocks: [
        block('L1', [
          testClaim('test/unit/a.test.ts', 'unit'),
          { kind: 'file', file: 'lib/a.ts', line: 1 },
        ]),
      ],
      reports: reports(report('unit', { '/ci/app/test/unit/a.test.ts': ['passed'] })),
    });
    expect(r.losses[0]!.verdict).toBe('LIT');
    expect(r.exitCode).toBe(0);
  });

  it('one non-LIT claim makes the loss DARK-IN-PRACTICE', () => {
    const r = computeVerdicts({
      ledgerPath: 'l.md',
      repoRoot: REPO,
      losses: ['L1'],
      blocks: [
        block('L1', [
          testClaim('test/unit/a.test.ts', 'unit'),
          testClaim('test/integration/b.test.ts', 'integration'),
        ]),
      ],
      reports: reports(report('unit', { '/ci/app/test/unit/a.test.ts': ['passed'] })),
    });
    expect(r.losses[0]!.verdict).toBe('DARK-IN-PRACTICE');
    expect(r.exitCode).toBe(1);
  });

  it('the headline is the weakest claim, not the first', () => {
    const r = computeVerdicts({
      ledgerPath: 'l.md',
      repoRoot: REPO,
      losses: ['L1'],
      blocks: [
        block('L1', [
          testClaim('test/unit/skipped.test.ts', 'unit'),
          testClaim('test/unit/failed.test.ts', 'unit'),
        ]),
      ],
      reports: reports(
        report('unit', {
          '/ci/app/test/unit/skipped.test.ts': ['skipped'],
          '/ci/app/test/unit/failed.test.ts': ['failed'],
        }),
      ),
    });
    expect(r.losses[0]!.headline).toMatch(/^FAILED: /);
  });

  it('ranks NO-REPORT as weaker than NOT-RUN and SKIPPED', () => {
    const r = computeVerdicts({
      ledgerPath: 'l.md',
      repoRoot: REPO,
      losses: ['L1'],
      blocks: [
        block('L1', [
          testClaim('test/unit/skipped.test.ts', 'unit'),
          testClaim('test/unit/absent.test.ts', 'unit'),
          testClaim('test/integration/b.test.ts', 'integration'),
        ]),
      ],
      reports: reports(report('unit', { '/ci/app/test/unit/skipped.test.ts': ['skipped'] })),
    });
    expect(r.losses[0]!.headline).toMatch(/^NO-REPORT: /);
  });

  it('a block covering nothing is dark, not vacuously lit', () => {
    const r = computeVerdicts({
      ledgerPath: 'l.md',
      repoRoot: REPO,
      losses: ['L1'],
      blocks: [block('L1', [])],
      reports: new Map(),
    });
    expect(r.losses[0]!.verdict).toBe('DARK-IN-PRACTICE');
    expect(r.exitCode).toBe(1);
  });
});

describe('UNCLAIMED', () => {
  it('flags a loss in the list with no lantern block', () => {
    const r = computeVerdicts({
      ledgerPath: 'l.md',
      repoRoot: REPO,
      losses: ['L1', 'L2', 'L3'],
      blocks: [block('L1', [{ kind: 'file', file: 'lib/a.ts', line: 1 }])],
      reports: new Map(),
    });
    const byLoss = Object.fromEntries(r.losses.map((l) => [l.loss, l.verdict]));
    expect(byLoss).toEqual({ L1: 'LIT', L2: 'UNCLAIMED', L3: 'UNCLAIMED' });
    expect(r.summary).toEqual({ total: 3, lit: 1, dark: 0, unclaimed: 2 });
    expect(r.exitCode).toBe(1);
  });

  it('still verifies a block whose loss is not in the list, and notes it', () => {
    const r = computeVerdicts({
      ledgerPath: 'l.md',
      repoRoot: REPO,
      losses: ['L1'],
      blocks: [
        block('L1', [{ kind: 'file', file: 'lib/a.ts', line: 1 }]),
        block('L9', [{ kind: 'file', file: 'lib/b.ts', line: 1 }]),
      ],
      reports: new Map(),
    });
    expect(r.losses.map((l) => l.loss)).toEqual(['L1', 'L9']);
    expect(r.notes.join('\n')).toContain('L9, which is not in the loss list');
  });

  it('notes a supplied report that no claim references', () => {
    const r = computeVerdicts({
      ledgerPath: 'l.md',
      repoRoot: REPO,
      losses: ['L1'],
      blocks: [block('L1', [testClaim('test/unit/a.test.ts', 'unit')])],
      reports: reports(
        report('unit', { '/ci/app/test/unit/a.test.ts': ['passed'] }),
        report('e2e', { '/ci/app/e2e/x.spec.ts': ['passed'] }),
      ),
    });
    expect(r.notes.join('\n')).toContain('no claim references that project');
  });
});

describe('orderForDisplay', () => {
  it('puts the worst loss first and unclaimed last', () => {
    const r = computeVerdicts({
      ledgerPath: 'l.md',
      repoRoot: REPO,
      losses: ['L1', 'L2', 'L3', 'L4'],
      blocks: [
        block('L1', [testClaim('test/unit/a.test.ts', 'unit')]),
        block('L2', [testClaim('test/integration/b.test.ts', 'integration')]),
        block('L3', [{ kind: 'file', file: 'lib/gone.ts', line: 1 }], false),
      ],
      reports: reports(report('unit', { '/ci/app/test/unit/a.test.ts': ['passed'] })),
    });
    expect(orderForDisplay(r.losses).map((l) => l.loss)).toEqual(['L3', 'L2', 'L1', 'L4']);
  });
});
