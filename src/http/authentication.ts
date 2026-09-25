import { TextCursor } from '../infra/text-cursor';
import { isHTTPTabOrSpace, isHTTPToken } from './syntax';

// RFC 9110 §§11.2–11.6.1. Repeated fields form one list; quoted commas stay in values.
/** Parse challenges in received order; return null for malformed syntax. */
export function parseAuthenticationChallenges(fields: string[]): AuthenticationChallenge[] | null {
  const cursor = new TextCursor(fields.join(','));
  const challenges: AuthenticationChallenge[] = [];
  while (true) {
    cursor.consumeWhile(isListSeparator);
    if (cursor.eof()) return challenges;
    const challenge = parseChallenge(cursor);
    if (challenge === null) return null;
    challenges.push(challenge);
    cursor.consumeWhile(isHTTPTabOrSpace);
    if (!cursor.eof() && cursor.peek() !== ',') return null;
  }
}

/** A challenge's lowercase names and unmodified values, including repeated parameters. */
export type AuthenticationChallenge = {
  scheme: string;
  /** Null when the challenge has no token68 payload. */
  token68: string | null;
  parameters: [name: string, value: string][];
};

function parseChallenge(cursor: TextCursor): AuthenticationChallenge | null {
  const scheme = readToken(cursor).toLowerCase();
  if (!scheme) return null;
  const challenge: AuthenticationChallenge = { scheme, token68: null, parameters: [] };
  // The scheme separator is 1*SP, not the broader OWS allowed around commas.
  if (cursor.consumeWhile((ch) => ch === ' ') === 0) return challenge;
  if (cursor.peek() === '\t') {
    cursor.consumeWhile(isHTTPTabOrSpace);
    if (!cursor.eof() && cursor.peek() !== ',') return null;
  }

  const start = cursor.pos();
  cursor.consumeWhile((ch) => token68CharacterPattern.test(ch));
  if (cursor.pos() !== start) {
    cursor.consumeWhile((ch) => ch === '=');
    const token68 = cursor.slice(start);
    cursor.consumeWhile(isHTTPTabOrSpace);
    if (cursor.eof() || cursor.peek() === ',') {
      challenge.token68 = token68;
      return challenge;
    }
  }
  cursor.restore(start);

  while (true) {
    const separator = cursor.pos();
    cursor.consumeWhile(isListSeparator);
    const name = readToken(cursor).toLowerCase();
    cursor.consumeWhile(isHTTPTabOrSpace);
    if (!name || !cursor.match('=')) {
      // A comma followed by a scheme starts the next challenge, not a parameter.
      cursor.restore(separator);
      return challenge;
    }
    cursor.consumeWhile(isHTTPTabOrSpace);
    const value = readParameterValue(cursor);
    if (value === null) return null;
    // Retain occurrences so scheme selection can reject ambiguous repeated parameters.
    challenge.parameters.push([name, value]);
    cursor.consumeWhile(isHTTPTabOrSpace);
    if (cursor.eof()) return challenge;
    if (cursor.peek() !== ',') return null;
  }
}

function readToken(cursor: TextCursor): string {
  const start = cursor.pos();
  cursor.consumeWhile(isHTTPToken);
  return cursor.slice(start);
}

function readParameterValue(cursor: TextCursor): string | null {
  if (!cursor.match('"')) return readToken(cursor) || null;
  // Unlike Fetch's quoted-string collector, RFC 9110 requires a closing quote
  // and only permits HTAB, SP, visible ASCII, and obs-text within quoted pairs.
  let value = '';
  while (!cursor.eof()) {
    let ch = cursor.next();
    if (ch === '"') return value;
    if (ch === '\\') {
      if (cursor.eof()) return null;
      ch = cursor.next();
    }
    if (ch !== '\t' && (ch < ' ' || ch === '\x7f' || ch > '\xff')) return null;
    value += ch;
  }
  return null;
}

function isListSeparator(ch: string): boolean {
  return ch === ',' || isHTTPTabOrSpace(ch);
}

const token68CharacterPattern = /^[A-Za-z0-9\-._~+/]$/;
