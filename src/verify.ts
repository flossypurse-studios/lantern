/**
 * Argument parsing and the one wiring function that joins parse -> resolve ->
 * report-load -> verdict. Kept out of cli.ts so tests can import it without
 * running a program.
 */
import fs from 'node:fs';
import path from 'node:path';
import { LanternError } from './errors.js';
import { parseLedger } from './parse-ledger.js';
import { loadReport } from './reports.js';
import { openRepo, resolveBlocks } from './resolve.js';
import { computeVerdicts } from './verdict.js';
import type { NormalizedReport, VerifyResult } from './types.js';

export const USAGE = `lantern verify <ledger.md> [--report <project>=<report.json>]... [--json]

Checks that the tests a loss ledger cites actually ran in the run you are
quoting. Not an existence checker: a test that exists but never executed is
reported as SKIPPED, NOT-RUN or NO-REPORT, never as a pass.

  --report <project>=<path>  A test-run report (vitest or playwright JSON).
                             <project> matches the "project:" key on a test
                             claim. Repeatable.
  --json                     Emit the whole result as JSON on stdout.

Exit codes: 0 every loss lit, 1 any loss dark-in-practice or unclaimed,
2 usage or parse error.`;

export interface Args {
  ledger: string;
  reports: Array<{ project: string; file: string }>;
  json: boolean;
}

export function parseArgs(argv: string[]): Args {
  if (argv.length === 0) throw new LanternError(USAGE);

  const command = argv[0]!;
  if (command === '--help' || command === '-h' || command === 'help') {
    throw new LanternError(USAGE);
  }
  if (command !== 'verify') {
    throw new LanternError(`unknown command "${command}"\n\n${USAGE}`);
  }

  const rest = argv.slice(1);
  let ledger: string | undefined;
  const reports: Array<{ project: string; file: string }> = [];
  let json = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === '--json') {
      json = true;
    } else if (arg === '--report' || arg.startsWith('--report=')) {
      const value = arg.startsWith('--report=')
        ? arg.slice('--report='.length)
        : rest[++i];
      if (value === undefined) {
        throw new LanternError('--report needs a value of the form <project>=<path>');
      }
      const eq = value.indexOf('=');
      if (eq <= 0 || eq === value.length - 1) {
        throw new LanternError(`--report must look like <project>=<path>, got "${value}"`);
      }
      const project = value.slice(0, eq);
      const file = value.slice(eq + 1);
      if (reports.some((r) => r.project === project)) {
        throw new LanternError(`--report given twice for project "${project}"`);
      }
      reports.push({ project, file });
    } else if (arg.startsWith('-')) {
      throw new LanternError(`unknown option "${arg}"\n\n${USAGE}`);
    } else if (ledger === undefined) {
      ledger = arg;
    } else {
      throw new LanternError(`unexpected extra argument "${arg}"\n\n${USAGE}`);
    }
  }

  if (ledger === undefined) {
    throw new LanternError(`verify needs a ledger path\n\n${USAGE}`);
  }
  return { ledger, reports, json };
}

/** Does the whole job and returns the result. No stdout, no process.exit. */
export function verify(args: Args): VerifyResult {
  const ledgerPath = path.resolve(args.ledger);
  let text: string;
  try {
    text = fs.readFileSync(ledgerPath, 'utf8');
  } catch {
    throw new LanternError(`could not read ledger: ${args.ledger}`);
  }

  const parsed = parseLedger(text, args.ledger);

  // `repo` is relative to the ledger file's own location, not to the cwd.
  const repoRoot = path.resolve(path.dirname(ledgerPath), parsed.config.repo);
  const repo = openRepo(repoRoot);

  const notes: string[] = [];
  if (!repo.isGitRepo) {
    notes.push(
      `${repoRoot} is not a git repository; commit citations cannot be checked there.`,
    );
  } else if (repo.gitToplevel) {
    notes.push(
      `repo is ${repoRoot} but git's top level is ${repo.gitToplevel}; commit citations were checked against that enclosing repository.`,
    );
  }

  const reports = new Map<string, NormalizedReport>();
  for (const r of args.reports) {
    reports.set(r.project, loadReport(r.project, path.resolve(r.file)));
  }

  return computeVerdicts({
    ledgerPath: args.ledger,
    repoRoot,
    blocks: resolveBlocks(parsed.blocks, repo),
    reports,
    losses: parsed.losses,
    notes,
  });
}
