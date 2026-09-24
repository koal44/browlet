import { asciiLower } from '../../../../infra/ascii';
import { forgivingBase64Decode } from '../../../../infra/base64';
import { parseIntegrityMetadata } from '../../../../fetch/index';
import {
  areSameOrigin, getDefaultPort, hostsEqual, obtainURLOrigin, percentDecodeString, serializeHost, serializeURLPath,
  type Host, type Origin, type URLRecord,
} from '../../../../url/index';

const schemeSourcePattern = /^([a-z][a-z0-9+.-]*):$/i;
const hostSourcePattern = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.?)(?::(\*|[0-9]+))?(\/.*)?$/i;
// RFC 3986 path-absolute, excluding CSP's semicolon and comma delimiters.
const sourcePathPattern = /^\/(?:(?:[a-z0-9._~!$&'()*+=:@-]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9._~!$&'()*+=:@-]|%[0-9a-f]{2})*)*)?$/i;
const nonceSourcePattern = /^'nonce-([a-z0-9+/_-]+={0,2})'$/i;
const hashSourcePattern = /^'(sha256|sha384|sha512)-([a-z0-9+/_-]+={0,2})'$/i;
const base64URLCharacters = /[-_]/g;

/** Match a URL against any source expression, using the policy list's retained origin. */
// https://w3c.github.io/webappsec-csp/#match-url-to-source-list
export function urlMatchesSourceList(url: URLRecord, sources: string[], origin: Origin, redirectCount: number): boolean {
  // Empty lists and 'none' match nothing; 'none' is inert beside other expressions.
  return sources.some((source) => urlMatchesSourceExpression(url, source, origin, redirectCount));
}

/** Compare a nonce as an exact string; its Base64 spelling is not decoded. */
// https://w3c.github.io/webappsec-csp/#match-nonce-to-source-list
export function nonceMatchesSourceList(nonce: string, sources: string[]): boolean {
  return nonce !== '' && sources.some((source) => nonceSourcePattern.exec(source)?.[1] === nonce);
}

/** Every supported integrity digest must be authorized, not just the strongest one. */
// https://w3c.github.io/webappsec-csp/#match-integrity-metadata-to-source-list
export function integrityMetadataMatchesSourceList(metadata: string, sources: string[]): boolean {
  const hashes: { algorithm: string; digest: Uint8Array; }[] = [];
  for (const source of sources) {
    const match = hashSourcePattern.exec(source);
    if (match === null) continue;
    const digest = decodeDigest(match[2]!);
    if (digest !== null) hashes.push({ algorithm: asciiLower(match[1]!), digest });
  }
  if (hashes.length === 0) return false;
  const parsed = parseIntegrityMetadata(metadata);
  if (parsed.length === 0) return false;
  return parsed.every(({ algorithm, digest }) => {
    // SPEC_CLASH(csp-decoded-integrity): Compare decoded digests, as Chromium
    // and WebKit do; the draft's algorithm and Gecko compare encoded strings.
    // Base64url and omitted padding have the same meaning here.
    const bytes = decodeDigest(digest);
    return bytes !== null && hashes.some((hash) => hash.algorithm === algorithm &&
      hash.digest.length === bytes.length && hash.digest.every((byte, i) => byte === bytes[i]));
  });
}

/** Whether a source expression authorizes the URL, including permitted secure upgrades. */
// https://w3c.github.io/webappsec-csp/#match-url-to-source-expression
export function urlMatchesSourceExpression(
  url: URLRecord, expression: string, origin: Origin, redirectCount: number,
): boolean {
  if (expression === '*') {
    return url.scheme === 'http' || url.scheme === 'https' ||
      (origin.kind === 'tuple' && url.scheme === origin.scheme);
  }
  const schemeSource = schemeSourcePattern.exec(expression);
  if (schemeSource !== null) return schemeMatches(schemeSource[1]!, url.scheme);

  const hostSource = hostSourcePattern.exec(expression);
  if (hostSource !== null) {
    const [, scheme, host, port, path] = hostSource;
    if (path !== undefined && !sourcePathPattern.test(path)) return false;
    const sourceScheme = scheme ?? (origin.kind === 'tuple' ? origin.scheme : undefined);
    if (sourceScheme === undefined || !schemeMatches(sourceScheme, url.scheme)) return false;
    if (url.host === null || !hostMatches(host!, url.host)) return false;
    if (!portMatches(port, url, asciiLower(sourceScheme))) return false;
    return path === undefined || redirectCount !== 0 || pathMatches(path, serializeURLPath(url));
  }

  if (asciiLower(expression) !== "'self'") return false;
  if (areSameOrigin(origin, obtainURLOrigin(url))) return true;
  if (origin.kind !== 'tuple' || url.host === null || !hostsEqual(origin.host, url.host)) return false;
  const samePort = origin.port === url.port ||
    ((origin.port === null || origin.port === getDefaultPort(origin.scheme)) &&
      (url.port === null || url.port === getDefaultPort(url.scheme)));
  return samePort && (url.scheme === 'https' || url.scheme === 'wss' ||
    (origin.scheme === 'http' && (url.scheme === 'http' || url.scheme === 'ws')));
}

// https://w3c.github.io/webappsec-csp/#match-schemes
function schemeMatches(source: string, target: string): boolean {
  // SPEC_CLASH(csp-websocket-schemes): Keep the draft's WebSocket-to-HTTP(S)
  // matches, also in WebKit; Chromium restricts WebSocket upgrades to WSS.
  source = asciiLower(source);
  return source === target ||
    (source === 'http' && target === 'https') ||
    (source === 'ws' && (target === 'wss' || target === 'http' || target === 'https')) ||
    (source === 'wss' && target === 'https');
}

// https://w3c.github.io/webappsec-csp/#match-hosts
function hostMatches(pattern: string, host: Host): boolean {
  // SPEC_CLASH(csp-ipv4-sources): Accept IPv4 hosts as browsers do; the
  // draft's current domain-only step excludes even explicit loopback sources.
  if (host.kind !== 'domain' && host.kind !== 'ipv4') return false;
  if (pattern === '*') return true;
  pattern = asciiLower(pattern);
  const value = asciiLower(serializeHost(host));
  return pattern.startsWith('*.') ? value.endsWith(pattern.slice(1)) : value === pattern;
}

// https://w3c.github.io/webappsec-csp/#match-ports
function portMatches(source: string | undefined, url: URLRecord, sourceScheme: string): boolean {
  if (source === '*') return true;
  const port = source === undefined ? null : Number(source);
  // SPEC_CLASH(csp-nondefault-port-upgrades): Keep equal-port matches across
  // scheme upgrades, as the draft and WebKit do; Chromium rejects HTTP :8080
  // matching HTTPS :8080.
  if (port === url.port || (url.port === null && port === getDefaultPort(url.scheme))) return true;
  // SPEC_CLASH(csp-secure-default-port): Preserve browser handling of an
  // explicit insecure default port when the scheme upgrades too; the draft
  // port algorithm omits this allowance.
  return port === 80 && (sourceScheme === 'http' || sourceScheme === 'ws') &&
    (url.scheme === 'https' || url.scheme === 'wss') && (url.port === null || url.port === 443);
}

// https://w3c.github.io/webappsec-csp/#match-paths
function pathMatches(source: string, target: string): boolean {
  if (source === '/' && target === '') return true;
  const exact = !source.endsWith('/');
  // SPEC_CLASH(csp-path-segments): Split before decoding, as the draft and
  // WebKit do; Chromium decodes whole paths, equating encoded and literal slashes.
  const sourceParts = source.split('/');
  const targetParts = target.split('/');
  if (sourceParts.length > targetParts.length || (exact && sourceParts.length !== targetParts.length)) return false;
  if (!exact) sourceParts.pop();
  return sourceParts.every((part, index) => {
    const a = percentDecodeString(part);
    const b = percentDecodeString(targetParts[index]!);
    return a.length === b.length && a.every((byte, i) => byte === b[i]);
  });
}

function decodeDigest(digest: string): Uint8Array | null {
  return forgivingBase64Decode(digest.replace(base64URLCharacters, (character) => character === '-' ? '+' : '/'));
}
