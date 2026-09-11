/**
 * Reading test-run reports and flattening them to one shape: a list of files,
 * each with a list of cases, each with a status.
 *
 * Format is auto-detected by shape, not by filename.
 */
import fs from 'node:fs';
import { LanternError } from './errors.js';
import type {
  CaseStatus,
  NormalizedReport,
  ReportFile,
  ReportFormat,
  TestCase,
} from './types.js';

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function detectFormat(data: unknown, source: string): ReportFormat {
  if (!isObject(data)) {
    throw new LanternError('report is not a JSON object', { file: source });
  }
  if (Array.isArray(data['testResults']) || typeof data['numTotalTests'] === 'number') {
    return 'vitest';
  }
  if (Array.isArray(data['suites'])) {
    return 'playwright';
  }
  throw new LanternError(
    'could not tell what kind of report this is; expected a vitest JSON report (top-level "testResults"/"numTotalTests") or a playwright JSON report (top-level "suites")',
    { file: source },
  );
}

function vitestStatus(raw: unknown): CaseStatus {
  switch (raw) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'skipped':
    case 'pending':
      return 'skipped';
    case 'todo':
      return 'todo';
    default:
      // An unknown status must not read as a pass.
      return 'failed';
  }
}

function parseVitest(data: Json, source: string): ReportFile[] {
  const results = data['testResults'];
  if (!Array.isArray(results)) {
    throw new LanternError('vitest report has no "testResults" array', {
      file: source,
    });
  }
  const files: ReportFile[] = [];
  for (const entry of results) {
    if (!isObject(entry)) continue;
    const name = entry['name'];
    if (typeof name !== 'string') {
      throw new LanternError(
        'vitest report has a testResults entry with no "name" path',
        { file: source },
      );
    }
    const assertions = entry['assertionResults'];
    const cases: TestCase[] = [];
    if (Array.isArray(assertions)) {
      for (const a of assertions) {
        if (!isObject(a)) continue;
        const title =
          (typeof a['fullName'] === 'string' && a['fullName']) ||
          (typeof a['title'] === 'string' && a['title']) ||
          '(unnamed case)';
        cases.push({ name: title, status: vitestStatus(a['status']) });
      }
    }
    if (cases.length === 0 && entry['status'] === 'failed') {
      // A file that blew up during collection reports no assertions at all.
      cases.push({ name: '(file failed to collect)', status: 'failed' });
    }
    files.push({ path: name, cases });
  }
  return files;
}

/**
 * Playwright's outcome vocabulary, mapped onto ours.
 *
 * `flaky` is mapped to `failed` on purpose: a guard that only holds on retry
 * is not a light that burns. This is a judgement call, documented in the
 * README.
 */
function playwrightStatus(test: Json): CaseStatus {
  const status = test['status'];
  switch (status) {
    case 'expected':
      return 'passed';
    case 'unexpected':
      return 'failed';
    case 'flaky':
      return 'failed';
    case 'skipped':
      return 'skipped';
    default:
      break;
  }

  // Fall back to the individual attempt results.
  const results = test['results'];
  if (Array.isArray(results) && results.length > 0) {
    const statuses = results.filter(isObject).map((r) => r['status']);
    if (statuses.some((s) => s === 'failed' || s === 'timedOut' || s === 'interrupted')) {
      return 'failed';
    }
    if (statuses.every((s) => s === 'skipped')) return 'skipped';
    if (statuses.some((s) => s === 'passed')) {
      const expected = test['expectedStatus'];
      return expected === 'failed' ? 'failed' : 'passed';
    }
  }
  return 'failed';
}

function parsePlaywright(data: Json, source: string): ReportFile[] {
  const byPath = new Map<string, TestCase[]>();

  const walk = (suite: unknown, inheritedFile: string | undefined): void => {
    if (!isObject(suite)) return;
    const file =
      typeof suite['file'] === 'string' && suite['file'] !== ''
        ? suite['file']
        : inheritedFile;

    const specs = suite['specs'];
    if (Array.isArray(specs)) {
      for (const spec of specs) {
        if (!isObject(spec)) continue;
        const specFile =
          typeof spec['file'] === 'string' && spec['file'] !== '' ? spec['file'] : file;
        if (specFile === undefined) {
          throw new LanternError(
            'playwright report has a spec with no "file" path anywhere up its suite chain',
            { file: source },
          );
        }
        const title = typeof spec['title'] === 'string' ? spec['title'] : '(unnamed spec)';
        const bucket = byPath.get(specFile) ?? [];
        byPath.set(specFile, bucket);

        const tests = spec['tests'];
        if (Array.isArray(tests) && tests.length > 0) {
          for (const t of tests) {
            if (!isObject(t)) continue;
            bucket.push({ name: title, status: playwrightStatus(t) });
          }
        } else {
          // No per-test detail; fall back to the spec's ok flag.
          bucket.push({ name: title, status: spec['ok'] === true ? 'passed' : 'failed' });
        }
      }
    }

    const nested = suite['suites'];
    if (Array.isArray(nested)) {
      for (const child of nested) walk(child, file);
    }
  };

  const suites = data['suites'];
  if (!Array.isArray(suites)) {
    throw new LanternError('playwright report has no "suites" array', {
      file: source,
    });
  }
  for (const s of suites) walk(s, undefined);

  return [...byPath.entries()].map(([path, cases]) => ({ path, cases }));
}

export function normalizeReport(
  data: unknown,
  project: string,
  source: string,
): NormalizedReport {
  const format = detectFormat(data, source);
  const obj = data as Json;
  const files = format === 'vitest' ? parseVitest(obj, source) : parsePlaywright(obj, source);
  return { project, format, source, files };
}

export function loadReport(project: string, filePath: string): NormalizedReport {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    throw new LanternError(`could not read report for project "${project}"`, {
      file: filePath,
    });
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new LanternError(
      `report for project "${project}" is not valid JSON: ${(err as Error).message}`,
      { file: filePath },
    );
  }
  return normalizeReport(data, project, filePath);
}
