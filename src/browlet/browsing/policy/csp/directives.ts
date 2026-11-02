import { asciiLower, forgivingBase64Decode } from '../../../../infra/index';
import { utf8Encode } from '../../../../encoding/index';
import type { Origin, URLRecord } from '../../../../url/index';
import {
  applyIntegrityAlgorithm, parseIntegrityMetadata, type FetchRequest, type IntegrityAlgorithm,
} from '../../../../fetch/index';

import { urlMatchesSourceExpression } from '../source-expressions';

/** One policy's directive names and token lists, interpreted by each directive's algorithm. */
// https://w3c.github.io/webappsec-csp/#framework-policy
export class CSPDirectives extends Map<string, CSPDirectiveValue> {
  /** Select the directive governing a request's intended use, before policy fallback. */
  // https://w3c.github.io/webappsec-csp/#effective-directive-for-a-request
  static getRequestDirective(request: FetchRequest): CSPFetchDirectiveName | null {
    if (request.initiator === 'prefetch' || request.initiator === 'prerender') return 'default-src';
    switch (request.destination) {
      case 'manifest': return 'manifest-src';
      case 'object': case 'embed': return 'object-src';
      case 'frame': case 'iframe': return 'frame-src';
      case 'audio': case 'track': case 'video': return 'media-src';
      case 'font': return 'font-src';
      case 'image': return 'img-src';
      case 'style': return 'style-src-elem';
      case 'script': case 'xslt': case 'audioworklet': case 'paintworklet': return 'script-src-elem';
      case 'serviceworker': case 'sharedworker': case 'worker': return 'worker-src';
      case 'report': return null;
      default: return 'connect-src';
    }
  }

  // https://w3c.github.io/webappsec-csp/#directive-fallback-list
  static #getFetchFallbackList(name: CSPFetchDirectiveName): CSPFetchDirectiveName[] {
    switch (name) {
      case 'script-src-elem': return ['script-src-elem', 'script-src', 'default-src'];
      case 'style-src-elem': return ['style-src-elem', 'style-src', 'default-src'];
      case 'worker-src': return ['worker-src', 'child-src', 'script-src', 'default-src'];
      case 'frame-src': return ['frame-src', 'child-src', 'default-src'];
      case 'connect-src': case 'manifest-src': case 'object-src':
      case 'media-src': case 'font-src': case 'img-src': return [name, 'default-src'];
      default: return [];
    }
  }

  /** Get the policy's first present fallback; an empty directive still stops fallback. */
  // https://w3c.github.io/webappsec-csp/#should-directive-execute
  getFetchDirective(requestDirective: CSPFetchDirectiveName): CSPFetchDirectiveName | undefined {
    return CSPDirectives.#getFetchFallbackList(requestDirective).find((name) => this.has(name));
  }

  /** Copy the directive map and each mutable token list. */
  clone(): CSPDirectives {
    const copy = new CSPDirectives();
    for (const [name, value] of this) copy.set(name, new CSPDirectiveValue(value.tokens.slice()));
    return copy;
  }
}

/** A directive's tokens, with source-list matching for directives that use it. */
// https://w3c.github.io/webappsec-csp/#framework-directive
export class CSPDirectiveValue {
  /** Whitespace-separated tokens, retaining the supplied array without copying it. */
  tokens: string[];

  constructor(tokens: string[] = []) {
    this.tokens = tokens;
  }

  /** Interpret these tokens as a source list and match a URL against its expressions. */
  // https://w3c.github.io/webappsec-csp/#match-url-to-source-list
  matchesURL(url: URLRecord, origin: Origin, redirectCount: number): boolean {
    // Empty lists and 'none' match nothing; 'none' is inert beside other expressions.
    return this.tokens.some((source) => urlMatchesSourceExpression(url, source, origin, redirectCount));
  }

  /** Compare a nonce as an exact string; its Base64 spelling is not decoded. */
  // https://w3c.github.io/webappsec-csp/#match-nonce-to-source-list
  matchesNonce(nonce: string): boolean {
    return nonce !== '' && this.tokens.some((source) => nonceSourcePattern.exec(source)?.[1] === nonce);
  }

  /** Every supported integrity digest must be authorized, not just the strongest one. */
  // https://w3c.github.io/webappsec-csp/#match-integrity-metadata-to-source-list
  matchesIntegrityMetadata(metadata: string): boolean {
    const hashes: { algorithm: string; digest: Uint8Array; }[] = [];
    for (const source of this.tokens) {
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

  /** Match style-attribute source, where nonces cannot authorize and hashes require unsafe-hashes. */
  // https://w3c.github.io/webappsec-csp/#match-element-to-source-list
  matchesStyleAttribute(source: string): boolean {
    let unsafeInline = false;
    let unsafeHashes = false;
    let hasNonceOrHash = false;
    const hashes: { algorithm: IntegrityAlgorithm; value: string; }[] = [];
    for (const token of this.tokens) {
      const keyword = asciiLower(token);
      if (keyword === "'unsafe-inline'") {
        unsafeInline = true;
      } else if (keyword === "'unsafe-hashes'") {
        unsafeHashes = true;
      } else if (nonceSourcePattern.test(token)) {
        hasNonceOrHash = true;
      } else {
        const match = hashSourcePattern.exec(token);
        if (match === null) continue;
        hasNonceOrHash = true;
        hashes.push({ algorithm: asciiLower(match[1]!) as IntegrityAlgorithm, value: match[2]! });
      }
    }
    // SPEC_CLASH(csp-style-attribute-nonce): Follow CSP/Chromium/Firefox;
    // a nonce source suppresses unsafe-inline and cannot authorize attributes.
    // WebKit instead authorizes a style attribute when the element's nonce matches.
    if (unsafeInline && !hasNonceOrHash) return true;
    if (!unsafeHashes || hashes.length === 0) return false;

    const bytes = utf8Encode(source);
    const digests: Partial<Record<IntegrityAlgorithm, Uint8Array>> = {};
    for (const { algorithm, value } of hashes) {
      // SPEC_CLASH(csp-decoded-integrity): As for external integrity metadata,
      // Chromium/WebKit accept equivalent Base64 spellings; Firefox/the draft do not.
      const expected = decodeDigest(value);
      if (expected === null) continue;
      const actual = digests[algorithm] ??= applyIntegrityAlgorithm(algorithm, bytes);
      if (actual.length === expected.length && actual.every((byte, i) => byte === expected[i])) return true;
    }
    return false;
  }
}

/** Names of source directives governing external requests and their fallbacks. */
export type CSPFetchDirectiveName = 'default-src' | 'child-src' | 'connect-src' | 'font-src' | 'frame-src' |
  'img-src' | 'manifest-src' | 'media-src' | 'object-src' | 'script-src' | 'script-src-elem' |
  'style-src' | 'style-src-elem' | 'worker-src';

const nonceSourcePattern = /^'nonce-([a-z0-9+/_-]+={0,2})'$/i;
const hashSourcePattern = /^'(sha256|sha384|sha512)-([a-z0-9+/_-]+={0,2})'$/i;
const base64URLCharacters = /[-_]/g;

function decodeDigest(digest: string): Uint8Array | null {
  return forgivingBase64Decode(digest.replace(base64URLCharacters, (character) => character === '-' ? '+' : '/'));
}
