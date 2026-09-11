/**
 * The heart of lantern, and deliberately pure: it takes already-resolved
 * claims plus already-parsed reports and returns verdicts. No filesystem, no
 * git, no process. Everything here is testable without a repo on disk.
 *
 * The central question a verdict answers is not "does this test exist" but
 * "did it run, in the run you are quoting?"
 */
import { pathsMatch } from './paths.js';
import type {
  Claim,
  ClaimVerdict,
  LossResult,
  NormalizedReport,
  ReportFile,
  ResolvedBlock,
  TestCase,
  Verdict,
  VerifyResult,
} from './types.js';

/** Worst first. Drives both the per-loss headline and the output ordering. */
const SEVERITY: Record<Verdict, number> = {
  UNRESOLVED: 0,
  FAILED: 1,
  'NO-REPORT': 2,
  'NOT-RUN': 3,
  SKIPPED: 4,
  LIT: 5,
};

export function verdictSeverity(v: Verdict): number {
  return SEVERITY[v];
}

export function describeClaim(claim: Claim): string {
  switch (claim.kind) {
    case 'test':
      return `${claim.test} (project: ${claim.project})`;
    case 'file':
      return claim.file;
    case 'symbol':
      return `${claim.symbol} in ${claim.file}`;
    case 'commit':
      return claim.commit;
  }
}

function countBy(cases: TestCase[]) {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let todo = 0;
  for (const c of cases) {
    if (c.status === 'passed') passed++;
    else if (c.status === 'failed') failed++;
    else if (c.status === 'skipped') skipped++;
    else todo++;
  }
  return { passed, failed, skipped, todo, total: cases.length };
}

function findInReport(
  report: NormalizedReport,
  claimRel: string,
  repoRoot: string,
): ReportFile[] {
  return report.files.filter((f) => pathsMatch(claimRel, repoRoot, f.path));
}

export interface VerdictInput {
  ledgerPath: string;
  /** absolute path to the repo root the citations resolve against */
  repoRoot: string;
  blocks: ResolvedBlock[];
  /** keyed by project name, exactly as given on the command line */
  reports: Map<string, NormalizedReport>;
  losses: string[];
  notes?: string[];
}

export function judgeClaim(
  claim: Claim,
  resolutionOk: boolean,
  resolutionDetail: string | undefined,
  reports: Map<string, NormalizedReport>,
  repoRoot: string,
): ClaimVerdict {
  if (!resolutionOk) {
    return {
      claim,
      verdict: 'UNRESOLVED',
      detail: resolutionDetail ?? 'not found in the repository',
    };
  }

  if (claim.kind !== 'test') {
    return { claim, verdict: 'LIT', detail: resolutionDetail ?? 'resolved' };
  }

  const report = reports.get(claim.project);
  if (!report) {
    return {
      claim,
      verdict: 'NO-REPORT',
      detail: `no report supplied for project "${claim.project}"; nothing shows this test ever ran`,
    };
  }

  const matches = findInReport(report, claim.test, repoRoot);
  if (matches.length === 0) {
    return {
      claim,
      verdict: 'NOT-RUN',
      detail: `a report was supplied for project "${claim.project}" but this file does not appear in it (filtered out by the runner's include globs, or gated so it never collected)`,
    };
  }

  const cases = matches.flatMap((m) => m.cases);
  const n = countBy(cases);

  if (n.total === 0) {
    return {
      claim,
      verdict: 'NOT-RUN',
      detail: `the file appears in the "${claim.project}" report with no test cases at all`,
    };
  }
  if (n.failed > 0) {
    return {
      claim,
      verdict: 'FAILED',
      detail: `${n.failed} of ${n.total} cases failed in the "${claim.project}" report`,
    };
  }
  const inert = n.skipped + n.todo;
  if (inert > 0) {
    const kinds: string[] = [];
    if (n.skipped > 0) kinds.push(`${n.skipped} skipped`);
    if (n.todo > 0) kinds.push(`${n.todo} todo`);
    return {
      claim,
      verdict: 'SKIPPED',
      detail: `${inert} of ${n.total} cases did not run (${kinds.join(', ')}) in the "${claim.project}" report`,
    };
  }
  return {
    claim,
    verdict: 'LIT',
    detail: `${n.passed} of ${n.total} cases passed in the "${claim.project}" report`,
  };
}

export function computeVerdicts(input: VerdictInput): VerifyResult {
  const { repoRoot, reports, blocks, losses } = input;
  const notes = [...(input.notes ?? [])];

  const byLoss = new Map<string, ResolvedBlock>();
  for (const b of blocks) byLoss.set(b.loss, b);

  for (const b of blocks) {
    if (!losses.includes(b.loss)) {
      notes.push(
        `ledger line ${b.line}: lantern block claims ${b.loss}, which is not in the loss list. Verified anyway.`,
      );
    }
  }

  const referenced = new Set<string>();
  for (const b of blocks) {
    for (const c of b.claims) {
      if (c.claim.kind === 'test') referenced.add(c.claim.project);
    }
  }
  for (const project of reports.keys()) {
    if (!referenced.has(project)) {
      notes.push(
        `a report was supplied for project "${project}" but no claim references that project.`,
      );
    }
  }

  // Every loss in the list, plus any block for a loss not in the list.
  const allLosses = [...losses];
  for (const b of blocks) if (!allLosses.includes(b.loss)) allLosses.push(b.loss);

  const results: LossResult[] = allLosses.map((loss) => {
    const block = byLoss.get(loss);
    if (!block) {
      return {
        loss,
        verdict: 'UNCLAIMED',
        headline: 'no lantern block; nothing is claimed to stand in front of this loss',
        claims: [],
      };
    }

    const claims = block.claims.map((rc) =>
      judgeClaim(rc.claim, rc.resolution.ok, rc.resolution.detail, reports, repoRoot),
    );

    if (claims.length === 0) {
      return {
        loss,
        verdict: 'DARK-IN-PRACTICE',
        headline: 'the lantern block covers nothing',
        claims,
      };
    }

    const weakest = claims.reduce((a, b) =>
      verdictSeverity(b.verdict) < verdictSeverity(a.verdict) ? b : a,
    );

    if (weakest.verdict === 'LIT') {
      return { loss, verdict: 'LIT', headline: '', claims };
    }
    return {
      loss,
      verdict: 'DARK-IN-PRACTICE',
      headline: `${weakest.verdict}: ${weakest.detail}`,
      claims,
    };
  });

  const lit = results.filter((r) => r.verdict === 'LIT').length;
  const unclaimed = results.filter((r) => r.verdict === 'UNCLAIMED').length;
  const dark = results.filter((r) => r.verdict === 'DARK-IN-PRACTICE').length;

  return {
    ledger: input.ledgerPath,
    repo: repoRoot,
    projectsWithReports: [...reports.keys()].sort(),
    losses: results,
    notes,
    summary: { total: results.length, lit, dark, unclaimed },
    exitCode: dark + unclaimed > 0 ? 1 : 0,
  };
}

/** Worst first, then by L-number; UNCLAIMED losses always last. */
export function orderForDisplay(losses: LossResult[]): LossResult[] {
  const rank = (r: LossResult): number => {
    if (r.verdict === 'UNCLAIMED') return 1000;
    if (r.verdict === 'LIT') return 900;
    return Math.min(...r.claims.map((c) => verdictSeverity(c.verdict)));
  };
  const num = (r: LossResult): number => Number.parseInt(r.loss.slice(1), 10) || 0;
  return [...losses].sort((a, b) => rank(a) - rank(b) || num(a) - num(b));
}
