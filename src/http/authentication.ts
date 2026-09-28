import { utf8Encode } from '../encoding/index';
import { forgivingBase64Encode } from '../infra/base64';
import { TextCursor } from '../infra/text-cursor';
import { isHTTPTabOrSpace, isHTTPToken } from './syntax';

/** Parse challenges in received order; return null for malformed syntax. */
// https://www.rfc-editor.org/rfc/rfc9110.html#section-11.6.1
// Repeated fields form one list; quoted commas stay in values.
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

/** Select the first valid Basic challenge, or null if none is usable. */
// https://www.rfc-editor.org/rfc/rfc7617.html#section-2
// The generic parser supplies lowercase names and parameter occurrences.
export function selectBasicChallenge(challenges: AuthenticationChallenge[]): BasicChallenge | null {
  for (const challenge of challenges) {
    if (challenge.scheme !== 'basic' || challenge.token68 !== null) continue;
    const parameters = new Map(challenge.parameters);
    // SPEC_CLASH(basic-challenge-validation): require a realm and unique parameters.
    // RFC 9110/7617 require these; Chromium/Gecko recover from missing/repeated realms.
    if (parameters.size !== challenge.parameters.length) continue;
    const realm = parameters.get('realm');
    if (realm === undefined) continue;
    // Charset is advisory; an unrecognized value does not select another encoding.
    const charset = parameters.get('charset')?.toLowerCase() === 'utf-8' ? 'UTF-8' : null;
    return { realm, charset };
  }
  return null;
}

/** Encode a Basic credentials field value, or null for invalid credentials. */
// https://www.rfc-editor.org/rfc/rfc7617.html#section-2.1
// Use UTF-8 regardless of the optional charset advice.
export function encodeBasicCredentials(username: string, password: string): string | null {
  if (username.includes(':') || !username.isWellFormed() || !password.isWellFormed()) return null;
  const userPass = `${username}:${password}`;
  for (let i = 0; i < userPass.length; i++) {
    const code = userPass.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return null;
  }
  // SPEC_CLASH(basic-credential-normalization): preserve input like browser encoders, despite §2.1's NFC advice.
  // Normalization can change existing passwords; Fielding and Reschke discuss that here:
  // https://mailarchive.ietf.org/arch/msg/http-auth/jcxUEEUp3b2duKJIAFkgqija6R8/
  // https://mailarchive.ietf.org/arch/msg/http-auth/6qmuXA6ETnh21wbWi-Pe_tvE53o/
  return `Basic ${forgivingBase64Encode(utf8Encode(userPass))}`;
}

/** A challenge's lowercase names and unmodified values, including repeated parameters. */
export type AuthenticationChallenge = {
  scheme: string;
  /** Null when the challenge has no token68 payload. */
  token68: string | null;
  parameters: [name: string, value: string][];
};

/** Basic's protection-space label and recognized charset advice. */
export type BasicChallenge = {
  realm: string;
  /** Null when no recognized charset advice was supplied. */
  charset: 'UTF-8' | null;
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
