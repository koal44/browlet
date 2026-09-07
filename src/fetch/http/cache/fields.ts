import { isHTTPToken } from '../../../shared/http';
import { TextCursor } from '../../../shared/text-cursor';

/**
 * RFC 9111 §5.2 — parse a combined Cache-Control field value.
 * Preserve duplicates and unknown directives for the consuming algorithm.
 * Malformed syntax returns null; an absent/empty list is represented by [].
 */
export function parseCacheControl(input: string): CacheDirective[] | null {
  const cursor = new TextCursor(input);
  const directives: CacheDirective[] = [];
  while (!cursor.eof()) {
    cursor.consumeWhile((ch) => ch === ' ' || ch === '\t' || ch === ',');
    if (cursor.eof()) break;
    const start = cursor.pos();
    cursor.consumeWhile(isHTTPToken);
    const name = cursor.slice(start).toLowerCase();
    if (!name) return null;
    let value: string | null = null;
    if (cursor.match('=')) {
      if (cursor.match('"')) {
        value = '';
        while (true) {
          if (cursor.eof()) return null;
          let ch = cursor.next();
          if (ch === '"') break;
          if (ch === '\\') {
            if (cursor.eof()) return null;
            ch = cursor.next();
          }
          if (ch !== '\t' && (ch < ' ' || ch === '\x7f' || ch > '\xff')) return null;
          value += ch;
        }
      } else {
        const start = cursor.pos();
        cursor.consumeWhile(isHTTPToken);
        value = cursor.slice(start);
        if (!value) return null;
      }
    }
    directives.push({ name, value });
    cursor.consumeWhile((ch) => ch === ' ' || ch === '\t');
    if (!cursor.eof() && !cursor.match(',')) return null;
  }
  return directives;
}

/** RFC 9111 §1.2.2 — nonnegative seconds, saturating on integer overflow. */
export function parseDeltaSeconds(input: string): number | null {
  if (input === '' || /[^0-9]/.test(input)) return null;
  return Math.min(Number(input), Number.MAX_SAFE_INTEGER);
}

/** RFC 9110 §12.5.5: lowercased field names, including any wildcard member. */
export function parseVary(input: string): string[] | null {
  const names: string[] = [];
  for (const member of input.split(',')) {
    const name = member.replace(/^[ \t]+|[ \t]+$/g, '');
    if (!name) continue;
    if (!isHTTPToken(name)) return null;
    names.push(name.toLowerCase());
  }
  return names;
}

/**
 * Keep absent (undefined) distinct from invalid/duplicate (null) constraints.
 * bareValue is the meaning of an argument-free directive, e.g. max-stale.
 */
export function getDeltaDirective(
  directives: readonly CacheDirective[],
  name: string,
  bareValue: number | null = null,
): number | null | undefined {
  const matches = directives.filter((directive) => directive.name === name);
  if (matches.length === 0) return undefined;
  if (matches.length !== 1) return null;
  return matches[0]!.value === null ? bareValue : parseDeltaSeconds(matches[0]!.value);
}

export type CacheDirective = {
  readonly name: string;
  readonly value: string | null;
};
