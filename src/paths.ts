/**
 * Matching a repo-relative claim path against the absolute paths a test runner
 * writes into its JSON report.
 *
 * A bug in either direction destroys the tool's value: match too loosely and a
 * dark loss reads as lit, match too tightly and a lit one reads as NOT-RUN.
 * So: exact resolved equality first, then suffix comparison on whole path
 * segments only. Never a bare string `includes`.
 */
import path from 'node:path';

/** Forward slashes, no trailing slash, no `.` or `..` segments left over. */
export function normalizePath(p: string): string {
  const norm = path.normalize(p).split(path.sep).join('/');
  return norm.length > 1 && norm.endsWith('/') ? norm.slice(0, -1) : norm;
}

/** Drop leading `./` so `./a/b.ts` and `a/b.ts` compare equal. */
export function stripDotSlash(p: string): string {
  let out = normalizePath(p);
  while (out.startsWith('./')) out = out.slice(2);
  return out;
}

/** True when `full` ends with `suffix` on a path-segment boundary. */
export function endsWithSegments(full: string, suffix: string): boolean {
  const f = normalizePath(full);
  const s = stripDotSlash(suffix);
  if (s === '' || s === '.') return false;
  if (f === s) return true;
  return f.endsWith('/' + s);
}

/**
 * @param claimRel   path as written in the ledger, relative to the repo root
 * @param repoRoot   absolute path to the repo root
 * @param reportPath path exactly as it appeared in the report JSON
 */
export function pathsMatch(
  claimRel: string,
  repoRoot: string,
  reportPath: string,
): boolean {
  const claimAbs = normalizePath(path.resolve(repoRoot, claimRel));
  const rawReport = normalizePath(reportPath);
  const reportAbs = normalizePath(
    path.isAbsolute(reportPath)
      ? path.resolve(reportPath)
      : path.resolve(repoRoot, reportPath),
  );

  if (claimAbs === reportAbs) return true;

  // The report path is longer than the claim: the usual case where the runner
  // reports an absolute path and the repo root sits below the ledger's notion
  // of it (nested repositories, monorepo package roots).
  if (endsWithSegments(reportAbs, claimRel)) return true;

  // The report path is shorter than the claim: a runner that emitted paths
  // relative to a directory deeper than the repo root.
  if (!path.isAbsolute(reportPath) && endsWithSegments(claimAbs, rawReport)) {
    return true;
  }

  return false;
}
