import { forgivingBase64Decode } from '../infra/base64';
import { asciiWhitespaceRunPattern } from '../infra/patterns';
import { computeHash } from '../js-engine/index';

/** Check the bytes against any digest using the strongest supported algorithm. */
// https://w3c.github.io/webappsec-subresource-integrity/#does-response-match-metadatalist
export function bytesMatchIntegrityMetadata(bytes: Uint8Array, metadataList: string): boolean {
  const metadata = getStrongestIntegrityMetadata(parseIntegrityMetadata(metadataList));
  if (metadata.length === 0) return true;
  const actual = applyIntegrityAlgorithm(metadata[0]!.algorithm, bytes);
  for (const item of metadata) {
    // Compare bytes so Base64url and omitted padding remain equivalent.
    const expected = forgivingBase64Decode(item.digest.replace(base64URLCharacters, toBase64Character));
    if (expected !== null && actual.length === expected.length && actual.every((byte, i) => byte === expected[i])) return true;
  }
  return false;
}

/** Parse supported hash expressions, ignoring malformed expressions and unknown options. */
// https://w3c.github.io/webappsec-subresource-integrity/#parse-metadata-section
export function parseIntegrityMetadata(metadata: string): IntegrityMetadata[] {
  const result: IntegrityMetadata[] = [];
  for (const expression of metadata.split(asciiWhitespaceRunPattern)) {
    const match = integrityMetadataPattern.exec(expression);
    if (match === null) continue;
    const name = match[1]!.toLowerCase();
    const algorithm = integrityAlgorithms.find((candidate) => candidate === name);
    if (algorithm !== undefined) result.push({ algorithm, digest: match[2]! });
  }
  return result;
}

/** Select every expression using the strongest algorithm, preserving their order. */
// https://w3c.github.io/webappsec-subresource-integrity/#get-the-strongest-metadata
export function getStrongestIntegrityMetadata(metadata: IntegrityMetadata[]): IntegrityMetadata[] {
  let strongest = -1;
  const result: IntegrityMetadata[] = [];
  for (const item of metadata) {
    const strength = integrityAlgorithms.indexOf(item.algorithm);
    if (strength < strongest) continue;
    if (strength > strongest) {
      strongest = strength;
      result.length = 0;
    }
    result.push(item);
  }
  return result;
}

/** Hash exactly the supplied byte view using one of SRI's supported algorithms. */
// https://w3c.github.io/webappsec-subresource-integrity/#apply-algorithm-to-response
export function applyIntegrityAlgorithm(algorithm: IntegrityAlgorithm, bytes: Uint8Array): Uint8Array {
  return computeHash(algorithm, bytes);
}

/** One supported hash expression; options have no defined behavior. */
export type IntegrityMetadata = {
  /** Canonical algorithm name, used to select the strongest expressions. */
  algorithm: IntegrityAlgorithm;
  /** Encoded digest, retained until verification. */
  digest: string;
};

/** The HTML-owned integrity policy fields used by request blocking and reporting. */
export type FetchIntegrityPolicy = {
  /** Locations from which integrity metadata may be supplied. */
  sources: 'inline'[];
  /** Request destinations that require integrity metadata. */
  blockedDestinations: ('script' | 'style')[];
  /** Reporting endpoint names, resolved by the owner's Reporting state. */
  endpoints: string[];
};

/** Data supplied to Reporting for one enforced or report-only integrity violation. */
export type IntegrityViolationReportBody = {
  /** Sanitized URL of the document or worker that initiated the request. */
  documentURL: string;
  /** Sanitized original request URL, before redirects. */
  blockedURL: string;
  /** Intended use of the blocked resource. */
  destination: string;
  /** Whether this report describes a policy that does not block the request. */
  reportOnly: boolean;
};

// https://w3c.github.io/webappsec-subresource-integrity/#valid-sri-hash-algorithm-token-set
const integrityAlgorithms = ['sha256', 'sha384', 'sha512'] as const;
export type IntegrityAlgorithm = typeof integrityAlgorithms[number];

// The attribute grammar supplies expression validity; browsers split on ASCII whitespace.
// https://w3c.github.io/webappsec-subresource-integrity/#the-integrity-attribute
const integrityMetadataPattern = /^([a-z0-9]+)-([a-z0-9+/_-]+={0,2})(?:\?[\x21-\x7e]*)?$/i;
const base64URLCharacters = /[-_]/g;
function toBase64Character(character: string): string { return character === '-' ? '+' : '/'; }
