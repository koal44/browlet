import { utf8Encode } from '../encoding/index';
import { forgivingBase64Encode } from '../infra/base64';
import type { AuthenticationChallenge } from './authentication';

// RFC 7617 §2. The generic parser supplies lowercase names and parameter occurrences.
/** Select the first valid Basic challenge, or null if none is usable. */
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

// RFC 7617 §§2–2.1. Use UTF-8 regardless of the optional charset advice.
/** Encode a Basic credentials field value, or null for invalid credentials. */
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

/** Basic's protection-space label and recognized charset advice. */
export type BasicChallenge = {
  realm: string;
  /** Null when no recognized charset advice was supplied. */
  charset: 'UTF-8' | null;
};
