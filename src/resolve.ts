/**
 * The I/O half: does the cited file, symbol or commit actually exist in the
 * repository the ledger points at?
 *
 * Note on `repo`: it is resolved relative to the LEDGER file, and used exactly
 * as given. The motivating failure for this tool involved a git repository
 * nested inside another one, where a checker pointed at the outer repo
 * false-negatived every commit citation. So every git call here is
 * `git -C <repoRoot>`, and lantern reports when the repo root it was handed is
 * not itself the top level of a repository.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { LanternError } from './errors.js';
import { normalizePath } from './paths.js';
import type { Claim, ClaimBlock, ResolvedBlock, Resolution } from './types.js';

function git(repoRoot: string, args: string[]): { ok: boolean; out: string } {
  try {
    const out = execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out: out.trim() };
  } catch {
    return { ok: false, out: '' };
  }
}

export interface RepoContext {
  root: string;
  isGitRepo: boolean;
  /** git's own top level, when it differs from `root` */
  gitToplevel: string | null;
}

export function openRepo(repoRoot: string): RepoContext {
  if (!fs.existsSync(repoRoot) || !fs.statSync(repoRoot).isDirectory()) {
    throw new LanternError(
      `repo path from lantern-config does not exist or is not a directory: ${repoRoot}`,
    );
  }
  const top = git(repoRoot, ['rev-parse', '--show-toplevel']);
  if (!top.ok) {
    return { root: repoRoot, isGitRepo: false, gitToplevel: null };
  }
  // Compare real paths: git reports the physical path, while the ledger may
  // point through a symlink (macOS /var -> /private/var being the usual one).
  const real = (p: string): string => {
    try {
      return normalizePath(fs.realpathSync(p));
    } catch {
      return normalizePath(p);
    }
  };
  const toplevel = normalizePath(top.out);
  return {
    root: repoRoot,
    isGitRepo: true,
    gitToplevel: real(toplevel) === real(repoRoot) ? null : toplevel,
  };
}

function fileExists(repoRoot: string, rel: string): boolean {
  const abs = path.resolve(repoRoot, rel);
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

/**
 * Plain word-boundary search over the file's text.
 *
 * This is NOT AST analysis. It will match an identifier inside a comment or a
 * string literal, and it cannot tell an export from a local. That is an honest
 * v1 limitation, stated here and in the README rather than dressed up.
 */
export function symbolInText(text: string, symbol: string): boolean {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`).test(text);
}

export function resolveClaim(claim: Claim, repo: RepoContext): Resolution {
  switch (claim.kind) {
    case 'test': {
      if (!fileExists(repo.root, claim.test)) {
        return { ok: false, detail: `test file not found in the repo: ${claim.test}` };
      }
      return { ok: true };
    }
    case 'file': {
      if (!fileExists(repo.root, claim.file)) {
        return { ok: false, detail: `file not found in the repo: ${claim.file}` };
      }
      return { ok: true, detail: 'file present' };
    }
    case 'symbol': {
      if (!fileExists(repo.root, claim.file)) {
        return {
          ok: false,
          detail: `file not found in the repo: ${claim.file} (so the symbol cannot be checked)`,
        };
      }
      const text = fs.readFileSync(path.resolve(repo.root, claim.file), 'utf8');
      if (!symbolInText(text, claim.symbol)) {
        return {
          ok: false,
          detail: `"${claim.symbol}" does not appear in ${claim.file}`,
        };
      }
      return { ok: true, detail: `"${claim.symbol}" appears in ${claim.file}` };
    }
    case 'commit': {
      if (!repo.isGitRepo) {
        return {
          ok: false,
          detail: `${repo.root} is not a git repository, so commit citations cannot be checked`,
        };
      }
      const type = git(repo.root, ['cat-file', '-t', claim.commit]);
      if (!type.ok || type.out !== 'commit') {
        return { ok: false, detail: `commit ${claim.commit} does not resolve in this repo` };
      }
      const full = git(repo.root, ['rev-parse', '--verify', `${claim.commit}^{commit}`]);
      const ancestor = git(repo.root, [
        'merge-base',
        '--is-ancestor',
        claim.commit,
        'HEAD',
      ]);
      if (!ancestor.ok) {
        return {
          ok: false,
          detail: `commit ${claim.commit} resolves but is not an ancestor of HEAD`,
        };
      }
      return {
        ok: true,
        detail: `commit ${full.ok ? full.out.slice(0, 12) : claim.commit} is an ancestor of HEAD`,
      };
    }
  }
}

export function resolveBlocks(blocks: ClaimBlock[], repo: RepoContext): ResolvedBlock[] {
  return blocks.map((b) => ({
    loss: b.loss,
    line: b.line,
    claims: b.claims.map((claim) => ({ claim, resolution: resolveClaim(claim, repo) })),
  }));
}
