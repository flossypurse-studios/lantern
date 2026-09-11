/**
 * Path matching gets its own file on purpose. A bug in either direction
 * destroys the tool: match too loosely and a dark loss reads as lit, match too
 * tightly and a lit one reads as NOT-RUN.
 */
import { describe, it, expect } from 'vitest';
import { pathsMatch, endsWithSegments, normalizePath, stripDotSlash } from '../src/paths.js';

const REPO = '/home/me/work/customerflow/app';

describe('normalizePath / stripDotSlash', () => {
  it('collapses . and .. segments', () => {
    expect(normalizePath('/a/b/../c/./d')).toBe('/a/c/d');
  });
  it('drops a trailing slash', () => {
    expect(normalizePath('/a/b/')).toBe('/a/b');
  });
  it('keeps the root slash', () => {
    expect(normalizePath('/')).toBe('/');
  });
  it('strips a leading ./', () => {
    expect(stripDotSlash('./test/a.test.ts')).toBe('test/a.test.ts');
  });
});

describe('endsWithSegments', () => {
  it('matches on a segment boundary', () => {
    expect(endsWithSegments('/a/b/c.ts', 'b/c.ts')).toBe(true);
  });
  it('matches the whole string', () => {
    expect(endsWithSegments('b/c.ts', 'b/c.ts')).toBe(true);
  });
  it('refuses a mid-segment match', () => {
    expect(endsWithSegments('/a/foobar/c.ts', 'bar/c.ts')).toBe(false);
  });
  it('refuses an empty suffix', () => {
    expect(endsWithSegments('/a/b.ts', '')).toBe(false);
  });
});

describe('pathsMatch', () => {
  it('matches an absolute report path under the same repo root', () => {
    expect(
      pathsMatch('test/unit/a.test.ts', REPO, '/home/me/work/customerflow/app/test/unit/a.test.ts'),
    ).toBe(true);
  });

  it('matches an absolute report path from a different checkout root', () => {
    // The usual CI case: the runner reported /ci/workspace/app/..., the ledger
    // is being verified against a local clone somewhere else entirely.
    expect(
      pathsMatch('test/unit/a.test.ts', REPO, '/ci/workspace/app/test/unit/a.test.ts'),
    ).toBe(true);
  });

  it('matches a repo-relative report path', () => {
    expect(pathsMatch('test/unit/a.test.ts', REPO, 'test/unit/a.test.ts')).toBe(true);
  });

  it('matches a ./-prefixed report path', () => {
    expect(pathsMatch('test/unit/a.test.ts', REPO, './test/unit/a.test.ts')).toBe(true);
  });

  it('matches a ./-prefixed claim path', () => {
    expect(
      pathsMatch('./test/unit/a.test.ts', REPO, '/ci/workspace/app/test/unit/a.test.ts'),
    ).toBe(true);
  });

  it('matches when the report path is shorter than the claim path', () => {
    // A runner that emitted paths relative to a directory below the repo root.
    expect(pathsMatch('packages/api/test/a.test.ts', REPO, 'test/a.test.ts')).toBe(true);
  });

  it('does not match a different file in the same directory', () => {
    expect(
      pathsMatch('test/unit/a.test.ts', REPO, '/ci/workspace/app/test/unit/b.test.ts'),
    ).toBe(false);
  });

  it('does not match a same-named file in a different project', () => {
    // The dangerous false positive: unit and integration both have erasure.test.ts.
    expect(
      pathsMatch(
        'test/integration/erasure.test.ts',
        REPO,
        '/ci/workspace/app/test/unit/erasure.test.ts',
      ),
    ).toBe(false);
  });

  it('does not match on a partial trailing segment', () => {
    expect(
      pathsMatch('test/unit/guards.test.ts', REPO, '/ci/workspace/app/test/unit/refund-guards.test.ts'),
    ).toBe(false);
  });

  it('does not match a mere basename collision', () => {
    expect(pathsMatch('a/b/c.test.ts', REPO, '/somewhere/else/c.test.ts')).toBe(false);
  });

  it('resolves .. inside a claim path before comparing', () => {
    expect(
      pathsMatch('test/../test/unit/a.test.ts', REPO, '/ci/workspace/app/test/unit/a.test.ts'),
    ).toBe(true);
  });
});
