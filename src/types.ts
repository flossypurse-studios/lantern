/** Shared shapes. No I/O, no logic. */

export type ClaimKind = 'test' | 'file' | 'symbol' | 'commit';

export interface TestClaim {
  kind: 'test';
  /** repo-relative path to the test file */
  test: string;
  /** which test project/suite this file belongs to; keys the --report map */
  project: string;
  line: number;
}

export interface FileClaim {
  kind: 'file';
  file: string;
  line: number;
}

export interface SymbolClaim {
  kind: 'symbol';
  symbol: string;
  file: string;
  line: number;
}

export interface CommitClaim {
  kind: 'commit';
  commit: string;
  line: number;
}

export type Claim = TestClaim | FileClaim | SymbolClaim | CommitClaim;

export interface ClaimBlock {
  loss: string;
  claims: Claim[];
  /** line of the opening fence in the ledger */
  line: number;
}

export interface LedgerConfig {
  repo: string;
  line: number;
}

export interface ParsedLedger {
  ledgerPath: string;
  config: LedgerConfig;
  blocks: ClaimBlock[];
  /** L-numbers found in the loss-list section, in document order */
  losses: string[];
}

/** Outcome of checking a claim against the repository on disk. Produced by resolve.ts. */
export interface Resolution {
  ok: boolean;
  /** human-readable reason, present when ok is false, and sometimes when true */
  detail?: string;
}

export interface ResolvedClaim {
  claim: Claim;
  resolution: Resolution;
}

export interface ResolvedBlock {
  loss: string;
  line: number;
  claims: ResolvedClaim[];
}

export type CaseStatus = 'passed' | 'failed' | 'skipped' | 'todo';

export interface TestCase {
  name: string;
  status: CaseStatus;
}

export interface ReportFile {
  /** path exactly as it appeared in the report */
  path: string;
  cases: TestCase[];
}

export type ReportFormat = 'vitest' | 'playwright';

export interface NormalizedReport {
  project: string;
  format: ReportFormat;
  /** path to the report JSON on disk, for error messages */
  source: string;
  files: ReportFile[];
}

export type Verdict =
  | 'LIT'
  | 'SKIPPED'
  | 'FAILED'
  | 'NOT-RUN'
  | 'NO-REPORT'
  | 'UNRESOLVED';

export type LossVerdict = 'LIT' | 'DARK-IN-PRACTICE' | 'UNCLAIMED';

export interface ClaimVerdict {
  claim: Claim;
  verdict: Verdict;
  detail: string;
}

export interface LossResult {
  loss: string;
  verdict: LossVerdict;
  /** the weakest claim's reason; empty for a LIT loss */
  headline: string;
  claims: ClaimVerdict[];
}

export interface VerifyResult {
  ledger: string;
  repo: string;
  projectsWithReports: string[];
  losses: LossResult[];
  /** non-fatal observations that do not affect the exit code */
  notes: string[];
  summary: {
    total: number;
    lit: number;
    dark: number;
    unclaimed: number;
  };
  exitCode: 0 | 1;
}
