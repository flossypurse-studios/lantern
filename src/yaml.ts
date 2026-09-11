/**
 * A deliberately tiny YAML subset parser, hand-rolled so that lantern has no
 * runtime dependencies.
 *
 * What it accepts, and nothing more:
 *   - top-level `key: value` scalar entries
 *   - top-level `key:` followed by an indented list of maps:
 *         key:
 *           - a: one
 *             b: two
 *           - a: three
 *   - `#` comments, outside of quotes
 *   - bare, single-quoted or double-quoted string scalars
 *
 * Everything else is an error. That is the point: a typo'd key must not
 * silently drop a claim, because a silently dropped claim is exactly the class
 * of failure this tool exists to catch.
 */
import { LanternError } from './errors.js';

export interface YamlEntry {
  key: string;
  value: string;
  line: number;
}

export interface YamlItem {
  entries: YamlEntry[];
  line: number;
}

export interface YamlList {
  key: string;
  line: number;
  items: YamlItem[];
}

export interface YamlDoc {
  scalars: YamlEntry[];
  lists: YamlList[];
}

const KEY_RE = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/;

/** Strip a trailing `#` comment, respecting single and double quotes. */
export function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#') {
      // Only a comment when it starts the line or follows whitespace, so that
      // a bare scalar such as `commit: 7c3a1e9#1` is not mangled.
      if (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t') {
        return line.slice(0, i);
      }
    }
  }
  return line;
}

function unquote(raw: string, file: string, line: number): string {
  const v = raw.trim();
  if (v.length >= 2) {
    const first = v[0]!;
    const last = v[v.length - 1]!;
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return v.slice(1, -1);
    }
    if (first === '"' || first === "'") {
      throw new LanternError(`unterminated quoted string: ${v}`, { file, line });
    }
  }
  return v;
}

function indentOf(line: string, file: string, lineNo: number): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  if (line[n] === '\t') {
    throw new LanternError('tabs are not allowed for indentation', {
      file,
      line: lineNo,
    });
  }
  return n;
}

function addEntry(
  entries: YamlEntry[],
  entry: YamlEntry,
  file: string,
  context: string,
): void {
  if (entries.some((e) => e.key === entry.key)) {
    throw new LanternError(`duplicate key "${entry.key}" in ${context}`, {
      file,
      line: entry.line,
    });
  }
  entries.push(entry);
}

/**
 * @param text        block body, without the fences
 * @param file        ledger path, for error messages
 * @param lineOffset  absolute line number of the block's FIRST body line
 */
export function parseYamlSubset(
  text: string,
  file: string,
  lineOffset: number,
): YamlDoc {
  const doc: YamlDoc = { scalars: [], lists: [] };
  const rawLines = text.split('\n');

  // The list we are currently filling, if the last top-level key had no value.
  let openList: YamlList | null = null;
  let itemIndent = -1;
  let currentItem: YamlItem | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = lineOffset + i;
    const raw = rawLines[i]!;
    const line = stripComment(raw).replace(/\s+$/, '');
    if (line.trim() === '') continue;

    const indent = indentOf(line, file, lineNo);
    const body = line.slice(indent);

    if (indent === 0) {
      if (body.startsWith('- ')) {
        throw new LanternError(
          'list item at top level; lists must be indented under a key',
          { file, line: lineNo },
        );
      }
      const m = KEY_RE.exec(body);
      if (!m) {
        throw new LanternError(`expected "key: value", got: ${body}`, {
          file,
          line: lineNo,
        });
      }
      const key = m[1]!;
      const rest = (m[2] ?? '').trim();

      if (doc.scalars.some((e) => e.key === key) || doc.lists.some((l) => l.key === key)) {
        throw new LanternError(`duplicate key "${key}"`, { file, line: lineNo });
      }

      if (rest === '') {
        openList = { key, line: lineNo, items: [] };
        itemIndent = -1;
        currentItem = null;
        doc.lists.push(openList);
      } else {
        openList = null;
        itemIndent = -1;
        currentItem = null;
        doc.scalars.push({ key, value: unquote(rest, file, lineNo), line: lineNo });
      }
      continue;
    }

    // indented
    if (!openList) {
      throw new LanternError(
        'unexpected indented line; it does not belong to any key',
        { file, line: lineNo },
      );
    }

    if (body.startsWith('-')) {
      if (!body.startsWith('- ')) {
        throw new LanternError('list item must be written as "- key: value"', {
          file,
          line: lineNo,
        });
      }
      if (itemIndent === -1) {
        itemIndent = indent;
      } else if (indent !== itemIndent) {
        throw new LanternError(
          `inconsistent list indentation under "${openList.key}" (expected ${itemIndent} spaces, got ${indent})`,
          { file, line: lineNo },
        );
      }
      const m = KEY_RE.exec(body.slice(2).trim());
      if (!m) {
        throw new LanternError(
          `expected "- key: value", got: ${body}`,
          { file, line: lineNo },
        );
      }
      currentItem = { entries: [], line: lineNo };
      openList.items.push(currentItem);
      addEntry(
        currentItem.entries,
        { key: m[1]!, value: unquote((m[2] ?? '').trim(), file, lineNo), line: lineNo },
        file,
        `list item under "${openList.key}"`,
      );
      continue;
    }

    // continuation key of the current list item
    if (!currentItem || itemIndent === -1) {
      throw new LanternError(
        `expected a list item ("- key: value") under "${openList.key}"`,
        { file, line: lineNo },
      );
    }
    if (indent !== itemIndent + 2) {
      throw new LanternError(
        `unexpected indentation (expected ${itemIndent + 2} spaces to continue the list item, got ${indent})`,
        { file, line: lineNo },
      );
    }
    const m = KEY_RE.exec(body);
    if (!m) {
      throw new LanternError(`expected "key: value", got: ${body}`, {
        file,
        line: lineNo,
      });
    }
    addEntry(
      currentItem.entries,
      { key: m[1]!, value: unquote((m[2] ?? '').trim(), file, lineNo), line: lineNo },
      file,
      `list item under "${openList.key}"`,
    );
  }

  for (const list of doc.lists) {
    if (list.items.length === 0) {
      throw new LanternError(`key "${list.key}" has no value and no list items`, {
        file,
        line: list.line,
      });
    }
  }

  return doc;
}
