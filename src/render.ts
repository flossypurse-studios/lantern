/**
 * Human output. Plain text, no colour libraries, no ANSI, no emoji.
 * One block per loss, worst first, then a summary line.
 */
import { describeClaim, orderForDisplay } from './verdict.js';
import type { LossResult, VerifyResult } from './types.js';

const VERDICT_WIDTH = 10;

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function renderLoss(loss: LossResult): string[] {
  const lines: string[] = [];
  lines.push(`${loss.loss}  ${loss.verdict}${loss.headline ? `  ${loss.headline}` : ''}`);
  for (const c of loss.claims) {
    lines.push(
      `  ${pad(c.verdict, VERDICT_WIDTH)} ${pad(c.claim.kind, 7)} ${describeClaim(c.claim)}`,
    );
    lines.push(`  ${' '.repeat(VERDICT_WIDTH)} ${' '.repeat(7)} ${c.detail}`);
  }
  return lines;
}

export function render(result: VerifyResult): string {
  const out: string[] = [];

  out.push(`ledger: ${result.ledger}`);
  out.push(`repo:   ${result.repo}`);
  out.push(
    `reports: ${
      result.projectsWithReports.length > 0
        ? result.projectsWithReports.join(', ')
        : 'none supplied'
    }`,
  );
  out.push('');

  const ordered = orderForDisplay(result.losses);
  if (ordered.length === 0) {
    out.push('No losses found in the loss list.');
    out.push('');
  }
  for (const loss of ordered) {
    out.push(...renderLoss(loss));
    out.push('');
  }

  if (result.notes.length > 0) {
    out.push('Notes:');
    for (const n of result.notes) out.push(`  ${n}`);
    out.push('');
  }

  const s = result.summary;
  out.push(
    `${s.total} ${s.total === 1 ? 'loss' : 'losses'}: ${s.lit} lit, ${s.dark} dark-in-practice, ${s.unclaimed} unclaimed.`,
  );
  if (s.dark + s.unclaimed === 0) {
    out.push('Every light is burning in the run you supplied.');
  } else {
    out.push(
      'A loss is only lit when every claim standing in front of it ran, in a run you supplied.',
    );
  }

  return out.join('\n');
}
