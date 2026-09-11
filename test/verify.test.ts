/**
 * End to end over the fixture ledgers: real files on disk, real reports, the
 * real wiring. Includes the signature case the tool was written for.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, verify } from '../src/verify.js';
import { render } from '../src/render.js';
import type { LossResult, VerifyResult } from '../src/types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures');
const ledger = (n: string) => path.join(FIX, n);
const report = (n: string) => path.join(FIX, 'reports', n);

function verdicts(r: VerifyResult): Record<string, string> {
  return Object.fromEntries(r.losses.map((l) => [l.loss, l.verdict]));
}

function claims(r: VerifyResult, loss: string): LossResult {
  return r.losses.find((l) => l.loss === loss)!;
}

describe('parseArgs', () => {
  it('parses a verify invocation', () => {
    const a = parseArgs([
      'verify',
      'l.md',
      '--report',
      'unit=u.json',
      '--report=integration=i.json',
      '--json',
    ]);
    expect(a.ledger).toBe('l.md');
    expect(a.json).toBe(true);
    expect(a.reports).toEqual([
      { project: 'unit', file: 'u.json' },
      { project: 'integration', file: 'i.json' },
    ]);
  });

  it('keeps an = inside the report path', () => {
    const a = parseArgs(['verify', 'l.md', '--report', 'unit=/tmp/a=b/u.json']);
    expect(a.reports[0]).toEqual({ project: 'unit', file: '/tmp/a=b/u.json' });
  });

  const bad: Array<[string, string[], RegExp]> = [
    ['no arguments', [], /lantern verify/],
    ['an unknown command', ['check', 'l.md'], /unknown command "check"/],
    ['a missing ledger', ['verify'], /verify needs a ledger path/],
    ['an unknown option', ['verify', 'l.md', '--deep'], /unknown option "--deep"/],
    ['an extra argument', ['verify', 'a.md', 'b.md'], /unexpected extra argument/],
    ['a report with no =', ['verify', 'l.md', '--report', 'unit'], /must look like/],
    ['a report with no path', ['verify', 'l.md', '--report', 'unit='], /must look like/],
    ['a report with no project', ['verify', 'l.md', '--report', '=u.json'], /must look like/],
    [
      'the same project twice',
      ['verify', 'l.md', '--report', 'unit=a.json', '--report', 'unit=b.json'],
      /given twice for project "unit"/,
    ],
  ];
  for (const [name, argv, pattern] of bad) {
    it(`rejects ${name}`, () => {
      expect(() => parseArgs(argv)).toThrow(pattern);
    });
  }
});

describe('the signature case: a claim with no report for its project', () => {
  const result = verify({
    ledger: ledger('ledger-signature.md'),
    reports: [{ project: 'unit', file: report('unit.json') }],
    json: false,
  });

  it('does not pass', () => {
    expect(result.exitCode).toBe(1);
  });

  it('reports NO-REPORT for the unreported project, not a pass', () => {
    const l8 = claims(result, 'L8');
    expect(l8.verdict).toBe('DARK-IN-PRACTICE');
    expect(l8.claims[0]!.verdict).toBe('NO-REPORT');
    expect(l8.claims[0]!.detail).toContain('nothing shows this test ever ran');
  });

  it('still lights the loss whose project was reported', () => {
    expect(claims(result, 'L1').verdict).toBe('LIT');
  });

  it('never prints the word LIT for the unreported loss', () => {
    const block = render(result)
      .split('\n\n')
      .find((b) => b.startsWith('L8'))!;
    expect(block).not.toContain('LIT');
    expect(block).toContain('NO-REPORT');
  });
});

describe('the same ledger with the integration report supplied', () => {
  it('goes green when the integration tests really ran', () => {
    const r = verify({
      ledger: ledger('ledger-signature.md'),
      reports: [
        { project: 'unit', file: report('unit.json') },
        { project: 'integration', file: report('integration.json') },
      ],
      json: false,
    });
    expect(verdicts(r)).toEqual({ L1: 'LIT', L8: 'LIT' });
    expect(r.exitCode).toBe(0);
  });

  it('stays red when the integration run was gated off', () => {
    const r = verify({
      ledger: ledger('ledger-signature.md'),
      reports: [
        { project: 'unit', file: report('unit.json') },
        { project: 'integration', file: report('integration-gated.json') },
      ],
      json: false,
    });
    const l8 = claims(r, 'L8');
    expect(l8.claims[0]!.verdict).toBe('SKIPPED');
    expect(l8.claims[0]!.detail).toContain('2 of 2 cases did not run');
    expect(r.exitCode).toBe(1);
  });
});

describe('the full fixture ledger', () => {
  const result = verify({
    ledger: ledger('ledger-full.md'),
    reports: [{ project: 'unit', file: report('unit.json') }],
    json: false,
  });

  it('produces every verdict the tool can produce', () => {
    expect(claims(result, 'L1').claims.map((c) => c.verdict)).toEqual(['LIT', 'LIT']);
    expect(claims(result, 'L2').claims[0]!.verdict).toBe('NO-REPORT');
    expect(claims(result, 'L3').claims[0]!.verdict).toBe('SKIPPED');
    expect(claims(result, 'L4').claims[0]!.verdict).toBe('FAILED');
    expect(claims(result, 'L5').claims[0]!.verdict).toBe('NOT-RUN');
    expect(claims(result, 'L6').claims.map((c) => c.verdict)).toEqual([
      'LIT',
      'UNRESOLVED',
      'UNRESOLVED',
    ]);
    expect(claims(result, 'L7').verdict).toBe('UNCLAIMED');
  });

  it('rolls up to one lit loss and six dark or unclaimed', () => {
    expect(result.summary).toEqual({ total: 7, lit: 1, dark: 5, unclaimed: 1 });
    expect(result.exitCode).toBe(1);
  });

  it('resolves repo relative to the ledger file, not the cwd', () => {
    expect(result.repo).toBe(path.join(FIX, 'repo'));
  });

  it('renders a scannable block per loss with no colour codes or emoji', () => {
    const text = render(result);
    // A real ESC byte, written as an escape so the source stays plain ASCII.
    expect(text).not.toMatch(/\u001b\[/);
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}]/u);
    expect(text).not.toContain('!');
    for (const loss of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']) {
      expect(text).toMatch(new RegExp(`^${loss}\\s`, 'm'));
    }
    expect(text).toContain('7 losses: 1 lit, 5 dark-in-practice, 1 unclaimed.');
  });

  it('puts the worst loss first', () => {
    const order = render(result)
      .split('\n')
      .filter((l) => /^L\d+\s/.test(l))
      .map((l) => l.split(/\s+/)[0]);
    expect(order[0]).toBe('L6');
    expect(order[order.length - 1]).toBe('L7');
  });
});

describe('errors', () => {
  it('refuses a ledger it cannot read', () => {
    expect(() => verify({ ledger: ledger('nope.md'), reports: [], json: false })).toThrow(
      /could not read ledger/,
    );
  });

  it('refuses a ledger with no loss-list section', () => {
    expect(() =>
      verify({ ledger: ledger('ledger-no-loss-list.md'), reports: [], json: false }),
    ).toThrow(/no loss-list section found/);
  });
});
