/**
 * The I/O half. Commit checks need a real repository, so these build a
 * throwaway one under the OS temp directory. Nothing here touches the
 * workspace, and nothing here is skipped: a skipped guard is the exact thing
 * lantern exists to catch, so it would be poor form to ship one.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openRepo, resolveClaim, symbolInText } from '../src/resolve.js';

let repoDir: string;
let nestedDir: string;
let headSha: string;
let nestedSha: string;

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function initRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'fixture@example.invalid']);
  git(dir, ['config', 'user.name', 'Lantern Fixture']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}

beforeAll(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-test-'));
  repoDir = path.join(base, 'outer');
  nestedDir = path.join(repoDir, 'app');

  initRepo(repoDir);
  fs.mkdirSync(path.join(repoDir, 'lib'), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, 'lib', 'guards.ts'),
    'export function applyRefund() {\n  return "ask";\n}\n// mentions notApplyRefundHere\n',
  );
  fs.writeFileSync(path.join(repoDir, 'lib', 'empty.ts'), '\n');
  fs.mkdirSync(path.join(repoDir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'test', 'a.test.ts'), '// test\n');
  git(repoDir, ['add', '-A']);
  git(repoDir, ['commit', '-q', '-m', 'first']);
  headSha = git(repoDir, ['rev-parse', 'HEAD']);

  // A second repository nested inside the first: the shape that motivated
  // lantern's insistence on using the repo path exactly as given.
  initRepo(nestedDir);
  fs.writeFileSync(path.join(nestedDir, 'inner.ts'), 'export const inner = 1;\n');
  git(nestedDir, ['add', '-A']);
  git(nestedDir, ['commit', '-q', '-m', 'inner']);
  nestedSha = git(nestedDir, ['rev-parse', 'HEAD']);
});

afterAll(() => {
  if (repoDir) fs.rmSync(path.dirname(repoDir), { recursive: true, force: true });
});

describe('symbolInText', () => {
  it('matches a whole identifier', () => {
    expect(symbolInText('export function applyRefund() {}', 'applyRefund')).toBe(true);
  });
  it('does not match a longer identifier containing it', () => {
    expect(symbolInText('const notApplyRefundHere = 1;', 'applyRefund')).toBe(false);
    expect(symbolInText('const applyRefundTwice = 1;', 'applyRefund')).toBe(false);
  });
  it('matches across $ and _ boundaries correctly', () => {
    expect(symbolInText('const a_applyRefund = 1;', 'applyRefund')).toBe(false);
    expect(symbolInText('obj.applyRefund()', 'applyRefund')).toBe(true);
  });
  it('escapes regex metacharacters in the symbol', () => {
    expect(symbolInText('const a = 1;', 'a.*')).toBe(false);
  });
});

describe('openRepo', () => {
  it('reports a plain repo root with no toplevel surprise', () => {
    const r = openRepo(repoDir);
    expect(r.isGitRepo).toBe(true);
    expect(r.gitToplevel).toBeNull();
  });

  it('treats a nested repo as its own repo, not the enclosing one', () => {
    const r = openRepo(nestedDir);
    expect(r.isGitRepo).toBe(true);
    expect(r.gitToplevel).toBeNull();
  });

  it('flags a non-root subdirectory so the difference is visible', () => {
    const sub = path.join(repoDir, 'lib');
    const r = openRepo(sub);
    expect(r.isGitRepo).toBe(true);
    expect(r.gitToplevel).not.toBeNull();
  });

  it('refuses a path that does not exist', () => {
    expect(() => openRepo(path.join(repoDir, 'nope'))).toThrow(/does not exist/);
  });
});

describe('resolveClaim', () => {
  it('resolves an existing file', () => {
    const r = resolveClaim({ kind: 'file', file: 'lib/guards.ts', line: 1 }, openRepo(repoDir));
    expect(r.ok).toBe(true);
  });

  it('does not resolve a missing file', () => {
    const r = resolveClaim({ kind: 'file', file: 'lib/gone.ts', line: 1 }, openRepo(repoDir));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('file not found');
  });

  it('does not resolve a directory as a file', () => {
    const r = resolveClaim({ kind: 'file', file: 'lib', line: 1 }, openRepo(repoDir));
    expect(r.ok).toBe(false);
  });

  it('resolves an existing test file', () => {
    const r = resolveClaim(
      { kind: 'test', test: 'test/a.test.ts', project: 'unit', line: 1 },
      openRepo(repoDir),
    );
    expect(r.ok).toBe(true);
  });

  it('does not resolve a missing test file', () => {
    const r = resolveClaim(
      { kind: 'test', test: 'test/gone.test.ts', project: 'unit', line: 1 },
      openRepo(repoDir),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('test file not found');
  });

  it('resolves a symbol present in the named file', () => {
    const r = resolveClaim(
      { kind: 'symbol', symbol: 'applyRefund', file: 'lib/guards.ts', line: 1 },
      openRepo(repoDir),
    );
    expect(r.ok).toBe(true);
  });

  it('does not resolve a symbol absent from the named file', () => {
    const r = resolveClaim(
      { kind: 'symbol', symbol: 'applyRefund', file: 'lib/empty.ts', line: 1 },
      openRepo(repoDir),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('does not appear in');
  });

  it('does not resolve a symbol whose file is missing', () => {
    const r = resolveClaim(
      { kind: 'symbol', symbol: 'x', file: 'lib/gone.ts', line: 1 },
      openRepo(repoDir),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('so the symbol cannot be checked');
  });

  it('resolves a full commit sha that is an ancestor of HEAD', () => {
    const r = resolveClaim({ kind: 'commit', commit: headSha, line: 1 }, openRepo(repoDir));
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('ancestor of HEAD');
  });

  it('resolves an abbreviated sha', () => {
    const r = resolveClaim(
      { kind: 'commit', commit: headSha.slice(0, 7), line: 1 },
      openRepo(repoDir),
    );
    expect(r.ok).toBe(true);
  });

  it('does not resolve an unknown sha', () => {
    const r = resolveClaim({ kind: 'commit', commit: '0000000', line: 1 }, openRepo(repoDir));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('does not resolve');
  });

  it('checks commits in the NESTED repo, not the enclosing one', () => {
    // This is the false-negative that motivated the tool: a checker pointed at
    // the outer repo cannot see the inner repo's commits, and vice versa.
    const outer = openRepo(repoDir);
    const inner = openRepo(nestedDir);

    expect(resolveClaim({ kind: 'commit', commit: nestedSha, line: 1 }, inner).ok).toBe(true);
    expect(resolveClaim({ kind: 'commit', commit: nestedSha, line: 1 }, outer).ok).toBe(false);
    expect(resolveClaim({ kind: 'commit', commit: headSha, line: 1 }, outer).ok).toBe(true);
    expect(resolveClaim({ kind: 'commit', commit: headSha, line: 1 }, inner).ok).toBe(false);
  });

  it('does not resolve commits when the path is not a git repository', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-plain-'));
    try {
      const r = resolveClaim({ kind: 'commit', commit: 'abc1234', line: 1 }, {
        root: plain,
        isGitRepo: false,
        gitToplevel: null,
      });
      expect(r.ok).toBe(false);
      expect(r.detail).toContain('not a git repository');
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});
