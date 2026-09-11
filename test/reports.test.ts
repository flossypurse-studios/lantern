import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectFormat, loadReport, normalizeReport } from '../src/reports.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'reports');

describe('detectFormat', () => {
  it('detects vitest by testResults', () => {
    expect(detectFormat({ testResults: [] }, 'r.json')).toBe('vitest');
  });
  it('detects vitest by numTotalTests', () => {
    expect(detectFormat({ numTotalTests: 3, testResults: [] }, 'r.json')).toBe('vitest');
  });
  it('detects playwright by suites', () => {
    expect(detectFormat({ suites: [] }, 'r.json')).toBe('playwright');
  });
  it('refuses an unrecognised shape rather than guessing', () => {
    expect(() => detectFormat({ results: [] }, 'r.json')).toThrow(
      /could not tell what kind of report/,
    );
  });
  it('refuses a non-object', () => {
    expect(() => detectFormat([1, 2], 'r.json')).toThrow(/not a JSON object/);
  });
});

describe('vitest reports', () => {
  const r = loadReport('unit', path.join(FIX, 'unit.json'));

  it('flattens every file', () => {
    expect(r.format).toBe('vitest');
    expect(r.files.map((f) => path.basename(f.path)).sort()).toEqual([
      'holdback.test.ts',
      'refund-guards.test.ts',
      'retention.test.ts',
      'unrelated-helpers.test.ts',
    ]);
  });

  it('keeps absolute paths exactly as reported', () => {
    expect(r.files[0]!.path).toBe('/ci/workspace/app/test/unit/refund-guards.test.ts');
  });

  it('carries per-case statuses through', () => {
    const retention = r.files.find((f) => f.path.endsWith('retention.test.ts'))!;
    expect(retention.cases.map((c) => c.status)).toEqual(['passed', 'skipped', 'skipped']);
  });

  it('maps todo through as todo', () => {
    const helpers = r.files.find((f) => f.path.endsWith('unrelated-helpers.test.ts'))!;
    expect(helpers.cases.map((c) => c.status)).toEqual(['passed', 'todo']);
  });

  it('treats pending as skipped', () => {
    const n = normalizeReport(
      {
        testResults: [
          { name: '/a/b.test.ts', assertionResults: [{ title: 't', status: 'pending' }] },
        ],
      },
      'unit',
      'r.json',
    );
    expect(n.files[0]!.cases[0]!.status).toBe('skipped');
  });

  it('never reads an unknown status as a pass', () => {
    const n = normalizeReport(
      {
        testResults: [
          { name: '/a/b.test.ts', assertionResults: [{ title: 't', status: 'weird' }] },
        ],
      },
      'unit',
      'r.json',
    );
    expect(n.files[0]!.cases[0]!.status).toBe('failed');
  });

  it('synthesises a failed case for a file that failed to collect', () => {
    const n = normalizeReport(
      { testResults: [{ name: '/a/b.test.ts', status: 'failed', assertionResults: [] }] },
      'unit',
      'r.json',
    );
    expect(n.files[0]!.cases).toHaveLength(1);
    expect(n.files[0]!.cases[0]!.status).toBe('failed');
  });

  it('refuses a testResults entry with no name', () => {
    expect(() =>
      normalizeReport({ testResults: [{ assertionResults: [] }] }, 'unit', 'r.json'),
    ).toThrow(/no "name" path/);
  });
});

describe('playwright reports', () => {
  const r = loadReport('e2e', path.join(FIX, 'e2e-playwright.json'));

  it('walks nested suites and groups by file', () => {
    expect(r.format).toBe('playwright');
    expect(r.files.map((f) => f.path).sort()).toEqual([
      '/ci/workspace/app/e2e/checkout.spec.ts',
      '/ci/workspace/app/e2e/receipts.spec.ts',
    ]);
  });

  it('maps expected to passed and skipped to skipped', () => {
    const checkout = r.files.find((f) => f.path.endsWith('checkout.spec.ts'))!;
    expect(checkout.cases.map((c) => c.status)).toEqual(['passed', 'skipped']);
  });

  it('maps unexpected to failed', () => {
    const receipts = r.files.find((f) => f.path.endsWith('receipts.spec.ts'))!;
    expect(receipts.cases.map((c) => c.status)).toEqual(['failed']);
  });

  it('treats flaky as failed', () => {
    const n = normalizeReport(
      {
        suites: [
          {
            file: '/a/x.spec.ts',
            specs: [{ title: 's', ok: true, tests: [{ status: 'flaky' }] }],
          },
        ],
      },
      'e2e',
      'r.json',
    );
    expect(n.files[0]!.cases[0]!.status).toBe('failed');
  });

  it('falls back to the results array when status is absent', () => {
    const n = normalizeReport(
      {
        suites: [
          {
            file: '/a/x.spec.ts',
            specs: [
              { title: 'a', ok: false, tests: [{ results: [{ status: 'timedOut' }] }] },
              { title: 'b', ok: true, tests: [{ results: [{ status: 'skipped' }] }] },
              {
                title: 'c',
                ok: true,
                tests: [{ expectedStatus: 'passed', results: [{ status: 'passed' }] }],
              },
            ],
          },
        ],
      },
      'e2e',
      'r.json',
    );
    expect(n.files[0]!.cases.map((c) => c.status)).toEqual(['failed', 'skipped', 'passed']);
  });

  it('falls back to the spec ok flag when there are no tests', () => {
    const n = normalizeReport(
      {
        suites: [
          {
            file: '/a/x.spec.ts',
            specs: [
              { title: 'a', ok: true, tests: [] },
              { title: 'b', ok: false, tests: [] },
            ],
          },
        ],
      },
      'e2e',
      'r.json',
    );
    expect(n.files[0]!.cases.map((c) => c.status)).toEqual(['passed', 'failed']);
  });

  it('inherits the file path from an enclosing suite', () => {
    const n = normalizeReport(
      {
        suites: [
          {
            file: '/a/x.spec.ts',
            specs: [],
            suites: [{ title: 'inner', specs: [{ title: 's', ok: true, tests: [] }] }],
          },
        ],
      },
      'e2e',
      'r.json',
    );
    expect(n.files[0]!.path).toBe('/a/x.spec.ts');
  });

  it('refuses a spec with no file anywhere up the chain', () => {
    expect(() =>
      normalizeReport({ suites: [{ specs: [{ title: 's', ok: true }] }] }, 'e2e', 'r.json'),
    ).toThrow(/no "file" path/);
  });
});

describe('loadReport', () => {
  it('reports an unreadable file clearly', () => {
    expect(() => loadReport('unit', path.join(FIX, 'nope.json'))).toThrow(
      /could not read report for project "unit"/,
    );
  });
});
