import { describe, it, expect } from 'vitest';
import { parseYamlSubset, stripComment } from '../src/yaml.js';
import { LanternError } from '../src/errors.js';

const F = 'ledger.md';

function parse(text: string, offset = 10) {
  return parseYamlSubset(text, F, offset);
}

describe('stripComment', () => {
  it('removes a whole-line comment', () => {
    expect(stripComment('# hello')).toBe('');
  });

  it('removes a trailing comment after whitespace', () => {
    expect(stripComment('loss: L8 # the gated one')).toBe('loss: L8 ');
  });

  it('leaves a # that is part of a token', () => {
    expect(stripComment('commit: abc#1')).toBe('commit: abc#1');
  });

  it('leaves a # inside quotes', () => {
    expect(stripComment('file: "lib/a#b.ts" # note')).toBe('file: "lib/a#b.ts" ');
  });
});

describe('parseYamlSubset', () => {
  it('parses top-level scalars', () => {
    const doc = parse('repo: ../../customerflow/app');
    expect(doc.scalars).toEqual([
      { key: 'repo', value: '../../customerflow/app', line: 10 },
    ]);
    expect(doc.lists).toEqual([]);
  });

  it('parses a list of maps with continuation keys', () => {
    const doc = parse(
      [
        'loss: L8',
        'covers:',
        '  - test: test/unit/refund-guards.test.ts',
        '    project: unit',
        '  - file: lib/refund-guards.ts',
      ].join('\n'),
    );
    expect(doc.scalars.map((s) => s.key)).toEqual(['loss']);
    expect(doc.lists).toHaveLength(1);
    const covers = doc.lists[0]!;
    expect(covers.key).toBe('covers');
    expect(covers.items).toHaveLength(2);
    expect(covers.items[0]!.entries.map((e) => [e.key, e.value])).toEqual([
      ['test', 'test/unit/refund-guards.test.ts'],
      ['project', 'unit'],
    ]);
    expect(covers.items[1]!.entries.map((e) => [e.key, e.value])).toEqual([
      ['file', 'lib/refund-guards.ts'],
    ]);
  });

  it('reports absolute ledger line numbers, not block-relative ones', () => {
    const doc = parse(['# comment', '', 'loss: L8'].join('\n'), 100);
    expect(doc.scalars[0]!.line).toBe(102);
  });

  it('strips comments and blank lines', () => {
    const doc = parse(['# leading', 'loss: L8   # trailing', '', ''].join('\n'));
    expect(doc.scalars[0]!.value).toBe('L8');
  });

  it('unquotes single and double quoted scalars', () => {
    const doc = parse(['a: "one two"', "b: 'three'"].join('\n'));
    expect(doc.scalars.map((s) => s.value)).toEqual(['one two', 'three']);
  });

  describe('rejections', () => {
    const cases: Array<[string, string, RegExp]> = [
      ['a line that is not key: value', 'just some prose', /expected "key: value"/],
      ['a tab indent', 'covers:\n\t- file: a.ts', /tabs are not allowed/],
      [
        'a top-level list item',
        '- file: a.ts',
        /list item at top level/,
      ],
      [
        'an indented line with no owning key',
        'loss: L1\n  file: a.ts',
        /does not belong to any key/,
      ],
      [
        'a list item that is not a map',
        'covers:\n  - just-a-string',
        /expected "- key: value"/,
      ],
      [
        'a bare dash with no space',
        'covers:\n  -file: a.ts',
        /must be written as "- key: value"/,
      ],
      [
        'inconsistent list indentation',
        'covers:\n  - file: a.ts\n      - file: b.ts',
        /inconsistent list indentation under "covers"/,
      ],
      [
        'a continuation key at the wrong indent',
        'covers:\n  - test: a.ts\n      project: unit',
        /unexpected indentation/,
      ],
      [
        'a duplicate top-level key',
        'loss: L1\nloss: L2',
        /duplicate key "loss"/,
      ],
      [
        'a duplicate key inside a list item',
        'covers:\n  - file: a.ts\n    file: b.ts',
        /duplicate key "file"/,
      ],
      [
        'a key with no value and no list',
        'covers:',
        /has no value and no list items/,
      ],
      [
        'an unterminated quoted string',
        'repo: "../app',
        /unterminated quoted string/,
      ],
    ];

    for (const [name, text, pattern] of cases) {
      it(`rejects ${name}`, () => {
        expect(() => parse(text)).toThrow(pattern);
      });
    }

    it('names the ledger file and the line number', () => {
      let caught: unknown;
      try {
        parse(['loss: L1', 'covers:', '  - file: a.ts', '    file: b.ts'].join('\n'), 40);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(LanternError);
      const e = caught as LanternError;
      expect(e.file).toBe('ledger.md');
      expect(e.line).toBe(43);
      expect(e.format()).toMatch(/^ledger\.md:43: /);
    });
  });
});
