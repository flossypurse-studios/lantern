/**
 * Ledger parsing: forgiving over prose, strict over fenced blocks.
 */
import { LanternError } from './errors.js';
import { parseYamlSubset, type YamlItem } from './yaml.js';
import type { Claim, ClaimBlock, LedgerConfig, ParsedLedger } from './types.js';

export interface Fence {
  info: string;
  body: string;
  /** absolute line of the opening fence */
  fenceLine: number;
  /** absolute line of the first body line */
  bodyLine: number;
}

export interface ScannedMarkdown {
  fences: Fence[];
  /** every line, with fenced regions blanked out so prose scans cannot see them */
  proseLines: string[];
}

const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;

export function scanMarkdown(text: string): ScannedMarkdown {
  const lines = text.split('\n');
  const fences: Fence[] = [];
  const proseLines = lines.slice();

  let i = 0;
  while (i < lines.length) {
    const m = FENCE_RE.exec(lines[i]!);
    if (!m) {
      i++;
      continue;
    }
    const marker = m[2]!;
    const char = marker[0]!;
    const info = m[3]!.trim();
    const openIdx = i;
    let close = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const cm = FENCE_RE.exec(lines[j]!);
      if (cm && cm[2]![0] === char && cm[2]!.length >= marker.length && cm[3]!.trim() === '') {
        close = j;
        break;
      }
    }
    const body = lines.slice(openIdx + 1, close).join('\n');
    fences.push({
      info,
      body,
      fenceLine: openIdx + 1,
      bodyLine: openIdx + 2,
    });
    for (let j = openIdx; j <= Math.min(close, lines.length - 1); j++) {
      proseLines[j] = '';
    }
    i = close + 1;
  }

  return { fences, proseLines };
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/**
 * Collect L-numbers from the loss-list section.
 *
 * Spec says "until the next `##` heading". Implemented as "until the next
 * heading at the same or a higher level", which is the same thing when the
 * loss list is an `##` section and does the right thing when it is an `###`
 * nested under one.
 */
export function extractLossList(proseLines: string[]): string[] | null {
  let start = -1;
  let level = 0;
  for (let i = 0; i < proseLines.length; i++) {
    const m = HEADING_RE.exec(proseLines[i]!);
    if (m && m[2]!.toLowerCase().includes('loss list')) {
      start = i + 1;
      level = m[1]!.length;
      break;
    }
  }
  if (start === -1) return null;

  const losses: string[] = [];
  const seen = new Set<string>();
  for (let i = start; i < proseLines.length; i++) {
    const line = proseLines[i]!;
    const hm = HEADING_RE.exec(line);
    if (hm && hm[1]!.length <= level) break;

    for (const id of leadingLossIds(line)) {
      if (!seen.has(id)) {
        seen.add(id);
        losses.push(id);
      }
    }
  }
  return losses;
}

/**
 * L-numbers in "bolded or table-leading position". A bare `L3` mentioned
 * mid-sentence is prose, not a loss-list entry, and is ignored on purpose.
 */
function leadingLossIds(line: string): string[] {
  const out: string[] = [];

  // **L3** anywhere on the line
  for (const m of line.matchAll(/\*\*\s*(L\d+)\s*\*\*/g)) out.push(m[1]!);

  // leading cell of a table row: | L3 | ... (skip separator rows)
  const cell = /^\s*\|\s*`?\*{0,2}\s*(L\d+)\s*\*{0,2}`?\s*\|/.exec(line);
  if (cell) out.push(cell[1]!);

  // start of a list item or line: - L3 — ...
  //
  // The emphasis markers are optional and deliberately unbalanced. Real ledgers
  // write `- **L8 — the whole headline is bold**`, where the `**` opens before
  // the identifier and closes at the end of the sentence, so the `**L3**` rule
  // above never fires on them.
  const lead =
    /^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:\*{1,2}|`)?\s*(L\d+)\s*(?:\*{1,2}|`)?\s*(?:[—–:.)\]]|-\s|$)/.exec(
      line,
    );
  if (lead) out.push(lead[1]!);

  return out;
}

const CLAIM_KEYS: Record<string, readonly string[]> = {
  test: ['test', 'project'],
  symbol: ['symbol', 'file'],
  file: ['file'],
  commit: ['commit'],
};

function parseClaimItem(item: YamlItem, file: string): Claim {
  const keys = item.entries.map((e) => e.key);
  const get = (k: string): string | undefined =>
    item.entries.find((e) => e.key === k)?.value;

  // Order matters: a symbol claim legitimately carries a `file` key too.
  const kind = keys.includes('test')
    ? 'test'
    : keys.includes('symbol')
      ? 'symbol'
      : keys.includes('file')
        ? 'file'
        : keys.includes('commit')
          ? 'commit'
          : null;

  if (!kind) {
    throw new LanternError(
      `claim has no recognised kind; expected one of test, file, symbol, commit (got: ${keys.join(', ') || 'nothing'})`,
      { file, line: item.line },
    );
  }

  const allowed = CLAIM_KEYS[kind]!;
  for (const entry of item.entries) {
    if (!allowed.includes(entry.key)) {
      throw new LanternError(
        `unexpected key "${entry.key}" on a ${kind} claim; a ${kind} claim takes ${allowed.map((k) => `"${k}"`).join(' and ')}`,
        { file, line: entry.line },
      );
    }
  }
  for (const required of allowed) {
    const v = get(required);
    if (v === undefined) {
      throw new LanternError(
        `a ${kind} claim requires a "${required}" key`,
        { file, line: item.line },
      );
    }
    if (v === '') {
      throw new LanternError(`"${required}" must not be empty`, {
        file,
        line: item.entries.find((e) => e.key === required)!.line,
      });
    }
  }

  switch (kind) {
    case 'test':
      return { kind, test: get('test')!, project: get('project')!, line: item.line };
    case 'symbol':
      return { kind, symbol: get('symbol')!, file: get('file')!, line: item.line };
    case 'file':
      return { kind, file: get('file')!, line: item.line };
    case 'commit':
      return { kind, commit: get('commit')!, line: item.line };
  }
}

export function parseClaimBlock(fence: Fence, file: string): ClaimBlock {
  const doc = parseYamlSubset(fence.body, file, fence.bodyLine);

  for (const s of doc.scalars) {
    if (s.key !== 'loss') {
      throw new LanternError(
        `unexpected key "${s.key}" in a lantern block; expected "loss" and "covers"`,
        { file, line: s.line },
      );
    }
  }
  for (const l of doc.lists) {
    if (l.key !== 'covers') {
      throw new LanternError(
        `unexpected key "${l.key}" in a lantern block; expected "loss" and "covers"`,
        { file, line: l.line },
      );
    }
  }

  const loss = doc.scalars.find((s) => s.key === 'loss');
  if (!loss) {
    throw new LanternError('lantern block is missing a "loss" key', {
      file,
      line: fence.fenceLine,
    });
  }
  if (!/^L\d+$/.test(loss.value)) {
    throw new LanternError(
      `loss identifier must look like "L8", got "${loss.value}"`,
      { file, line: loss.line },
    );
  }

  const covers = doc.lists.find((l) => l.key === 'covers');
  if (!covers) {
    throw new LanternError(
      `lantern block for ${loss.value} is missing a "covers" list`,
      { file, line: fence.fenceLine },
    );
  }

  return {
    loss: loss.value,
    line: fence.fenceLine,
    claims: covers.items.map((item) => parseClaimItem(item, file)),
  };
}

export function parseConfigBlock(fence: Fence, file: string): LedgerConfig {
  const doc = parseYamlSubset(fence.body, file, fence.bodyLine);
  if (doc.lists.length > 0) {
    throw new LanternError(
      `unexpected key "${doc.lists[0]!.key}" in lantern-config; expected only "repo"`,
      { file, line: doc.lists[0]!.line },
    );
  }
  for (const s of doc.scalars) {
    if (s.key !== 'repo') {
      throw new LanternError(
        `unexpected key "${s.key}" in lantern-config; expected only "repo"`,
        { file, line: s.line },
      );
    }
  }
  const repo = doc.scalars.find((s) => s.key === 'repo');
  if (!repo) {
    throw new LanternError('lantern-config block is missing a "repo" key', {
      file,
      line: fence.fenceLine,
    });
  }
  return { repo: repo.value, line: repo.line };
}

export function parseLedger(text: string, ledgerPath: string): ParsedLedger {
  const { fences, proseLines } = scanMarkdown(text);

  const configFences = fences.filter((f) => f.info === 'lantern-config');
  if (configFences.length === 0) {
    throw new LanternError(
      'no ```lantern-config block found; lantern needs one to know which repository the citations resolve against',
      { file: ledgerPath },
    );
  }
  if (configFences.length > 1) {
    throw new LanternError(
      `found ${configFences.length} lantern-config blocks; there must be exactly one (the others are at lines ${configFences
        .slice(1)
        .map((f) => f.fenceLine)
        .join(', ')})`,
      { file: ledgerPath, line: configFences[0]!.fenceLine },
    );
  }
  const config = parseConfigBlock(configFences[0]!, ledgerPath);

  const blocks = fences
    .filter((f) => f.info === 'lantern')
    .map((f) => parseClaimBlock(f, ledgerPath));

  const seen = new Map<string, number>();
  for (const b of blocks) {
    const prev = seen.get(b.loss);
    if (prev !== undefined) {
      throw new LanternError(
        `duplicate lantern block for ${b.loss} (first one is at line ${prev})`,
        { file: ledgerPath, line: b.line },
      );
    }
    seen.set(b.loss, b.line);
  }

  const losses = extractLossList(proseLines);
  if (losses === null) {
    throw new LanternError(
      'no loss-list section found; lantern looks for a heading whose text contains "loss list". Without it lantern cannot tell an unclaimed loss from an absent one, so it will not report zero losses instead.',
      { file: ledgerPath },
    );
  }

  return { ledgerPath, config, blocks, losses };
}
