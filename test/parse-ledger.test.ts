import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractLossList, parseLedger, scanMarkdown } from '../src/parse-ledger.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures');

function ledger(body: string): string {
  return ['```lantern-config', 'repo: ./repo', '```', '', '## Loss list', '', body].join('\n');
}

describe('scanMarkdown', () => {
  it('finds fences with their info strings and line numbers', () => {
    const { fences } = scanMarkdown(['# t', '', '```lantern', 'loss: L1', '```'].join('\n'));
    expect(fences).toHaveLength(1);
    expect(fences[0]!.info).toBe('lantern');
    expect(fences[0]!.fenceLine).toBe(3);
    expect(fences[0]!.bodyLine).toBe(4);
    expect(fences[0]!.body).toBe('loss: L1');
  });

  it('blanks fenced regions out of the prose view', () => {
    const { proseLines } = scanMarkdown(['**L1** x', '```lantern', '**L2** y', '```'].join('\n'));
    expect(proseLines.filter((l) => l !== '')).toEqual(['**L1** x']);
  });

  it('handles fences longer than three backticks', () => {
    const { fences } = scanMarkdown(['````lantern', 'loss: L1', '````'].join('\n'));
    expect(fences[0]!.info).toBe('lantern');
    expect(fences[0]!.body).toBe('loss: L1');
  });
});

describe('extractLossList', () => {
  const list = (md: string) => extractLossList(scanMarkdown(md).proseLines);

  it('returns null when there is no loss-list heading', () => {
    expect(list('# Notes\n\nSome prose about L1.')).toBeNull();
  });

  it('collects bolded ids', () => {
    expect(list('## Loss list\n\n- **L1** — a\n- **L2** — b')).toEqual(['L1', 'L2']);
  });

  it('collects table-leading ids and ignores the separator row', () => {
    const md = [
      '## Loss list',
      '| ID | Outcome |',
      '| --- | --- |',
      '| L3 | a |',
      '| L11 | b |',
    ].join('\n');
    expect(list(md)).toEqual(['L3', 'L11']);
  });

  it('collects line-leading ids', () => {
    expect(list('## Loss list\n\nL5 — a\nL6: b')).toEqual(['L5', 'L6']);
  });

  it('ignores an id mentioned mid-sentence', () => {
    expect(list('## Loss list\n\n- **L1** — as with L9, this is bad.')).toEqual(['L1']);
  });

  // Regression: the bold opens before the id and closes at the end of the
  // headline, which is how ledgers are actually written. Reading this shape as
  // an empty loss list made every real entry look UNCLAIMED.
  it('collects ids whose emphasis closes at the end of the headline', () => {
    const md = [
      '## The loss list (hers to edit)',
      '- **L8 — the system helps her make a costly mistake.** More prose here.',
      '- **L11 — something private is read by someone it harms.** And more.',
    ].join('\n');
    expect(list(md)).toEqual(['L8', 'L11']);
  });

  it('does not treat a leading id in a comma list as an entry', () => {
    expect(list('## Loss list\n\n- **L1 — a.**\nL8, L3 and L10 can fire tomorrow.')).toEqual([
      'L1',
    ]);
  });

  it('stops at the next heading of the same or a higher level', () => {
    const md = ['## Loss list', '- **L1** — a', '## Lights', '- **L2** — b'].join('\n');
    expect(list(md)).toEqual(['L1']);
  });

  it('does not stop at a deeper heading inside the section', () => {
    const md = ['## Loss list', '- **L1** — a', '### More', '- **L2** — b'].join('\n');
    expect(list(md)).toEqual(['L1', 'L2']);
  });

  it('matches a heading whose text merely contains "loss list"', () => {
    expect(list('# The loss list, in full\n\n- **L1** — a')).toEqual(['L1']);
  });

  it('never sees ids inside fenced blocks', () => {
    const md = ['## Loss list', '- **L1** — a', '```lantern', 'loss: L2', '```'].join('\n');
    expect(list(md)).toEqual(['L1']);
  });

  it('deduplicates', () => {
    expect(list('## Loss list\n\n- **L1** — a\n- **L1** — again')).toEqual(['L1']);
  });
});

describe('parseLedger — claim blocks', () => {
  it('parses all four claim kinds', () => {
    const md = ledger(
      [
        '- **L8** — a',
        '',
        '```lantern',
        'loss: L8',
        'covers:',
        '  - test: test/unit/a.test.ts',
        '    project: unit',
        '  - file: lib/a.ts',
        '  - symbol: applyRefund',
        '    file: lib/b.ts',
        '  - commit: 7c3a1e9',
        '```',
      ].join('\n'),
    );
    const parsed = parseLedger(md, 'l.md');
    expect(parsed.config.repo).toBe('./repo');
    expect(parsed.losses).toEqual(['L8']);
    expect(parsed.blocks[0]!.claims).toEqual([
      { kind: 'test', test: 'test/unit/a.test.ts', project: 'unit', line: 12 },
      { kind: 'file', file: 'lib/a.ts', line: 14 },
      { kind: 'symbol', symbol: 'applyRefund', file: 'lib/b.ts', line: 15 },
      { kind: 'commit', commit: '7c3a1e9', line: 17 },
    ]);
  });

  const bad: Array<[string, string[], RegExp]> = [
    [
      'a test claim with no project',
      ['loss: L1', 'covers:', '  - test: a.test.ts'],
      /a test claim requires a "project" key/,
    ],
    [
      'a typo’d key on a test claim',
      ['loss: L1', 'covers:', '  - test: a.test.ts', '    projet: unit'],
      /unexpected key "projet" on a test claim/,
    ],
    [
      'a stray key on a file claim',
      ['loss: L1', 'covers:', '  - file: a.ts', '    project: unit'],
      /unexpected key "project" on a file claim/,
    ],
    [
      'a symbol claim with no file',
      ['loss: L1', 'covers:', '  - symbol: foo'],
      /a symbol claim requires a "file" key/,
    ],
    [
      'a claim with no recognised kind',
      ['loss: L1', 'covers:', '  - project: unit'],
      /claim has no recognised kind/,
    ],
    ['a block with no loss key', ['covers:', '  - file: a.ts'], /missing a "loss" key/],
    ['a block with no covers list', ['loss: L1'], /missing a "covers" list/],
    [
      'an unknown top-level key in the block',
      ['loss: L1', 'owner: cully', 'covers:', '  - file: a.ts'],
      /unexpected key "owner" in a lantern block/,
    ],
    [
      'an unknown top-level list in the block',
      ['loss: L1', 'notes:', '  - file: a.ts', 'covers:', '  - file: b.ts'],
      /unexpected key "notes" in a lantern block/,
    ],
    [
      'a malformed loss identifier',
      ['loss: eight', 'covers:', '  - file: a.ts'],
      /must look like "L8"/,
    ],
    [
      'an empty value',
      ['loss: L1', 'covers:', '  - file: ""'],
      /"file" must not be empty/,
    ],
  ];

  for (const [name, lines, pattern] of bad) {
    it(`rejects ${name}`, () => {
      const md = ledger(['- **L1** — a', '', '```lantern', ...lines, '```'].join('\n'));
      expect(() => parseLedger(md, 'l.md')).toThrow(pattern);
    });
  }

  it('rejects two blocks for the same loss', () => {
    const md = ledger(
      [
        '- **L1** — a',
        '',
        '```lantern',
        'loss: L1',
        'covers:',
        '  - file: a.ts',
        '```',
        '',
        '```lantern',
        'loss: L1',
        'covers:',
        '  - file: b.ts',
        '```',
      ].join('\n'),
    );
    expect(() => parseLedger(md, 'l.md')).toThrow(/duplicate lantern block for L1/);
  });

  it('ignores fenced blocks that are not lantern blocks', () => {
    const md = ledger(
      ['- **L1** — a', '', '```ts', 'const x = 1;', '```'].join('\n'),
    );
    expect(parseLedger(md, 'l.md').blocks).toEqual([]);
  });
});

describe('parseLedger — config block', () => {
  it('requires exactly one config block', () => {
    expect(() => parseLedger('## Loss list\n\n- **L1** — a', 'l.md')).toThrow(
      /no ```lantern-config block found/,
    );
    const two = ['```lantern-config', 'repo: ./a', '```', '```lantern-config', 'repo: ./b', '```', '## Loss list'].join('\n');
    expect(() => parseLedger(two, 'l.md')).toThrow(/found 2 lantern-config blocks/);
  });

  it('rejects an unknown key in the config', () => {
    const md = ['```lantern-config', 'repo: ./a', 'branch: main', '```', '## Loss list'].join('\n');
    expect(() => parseLedger(md, 'l.md')).toThrow(/unexpected key "branch" in lantern-config/);
  });

  it('rejects a config with no repo', () => {
    const md = ['```lantern-config', '# nothing here', '```', '## Loss list'].join('\n');
    expect(() => parseLedger(md, 'l.md')).toThrow(/missing a "repo" key/);
  });
});

describe('parseLedger — fixtures on disk', () => {
  it('parses the full fixture ledger', () => {
    const md = fs.readFileSync(path.join(FIX, 'ledger-full.md'), 'utf8');
    const parsed = parseLedger(md, 'ledger-full.md');
    expect(parsed.losses).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']);
    expect(parsed.blocks.map((b) => b.loss)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
  });

  it('says so when there is no loss-list section', () => {
    const md = fs.readFileSync(path.join(FIX, 'ledger-no-loss-list.md'), 'utf8');
    expect(() => parseLedger(md, 'ledger-no-loss-list.md')).toThrow(
      /no loss-list section found/,
    );
  });
});
