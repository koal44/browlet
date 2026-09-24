import type { FetchResponse } from '../../../fetch/index';
import { isHTTPToken, isHTTPTabOrSpace } from '../../../http/index';
import { TextCursor } from '../../../infra/text-cursor';
import { nonASCIIDigitPattern } from '../../../infra/patterns';
import type { Host } from '../../../url/index';

/** Transport-security policies remembered across this user agent's documents. */
// https://www.rfc-editor.org/rfc/rfc6797.html#section-8.1
export class HSTSStore {
  /** Policies keyed by canonical ASCII domain, without the trailing DNS root dot. */
  hosts = new Map<string, HSTSHost>();
  /** Earliest epoch millisecond when an accepted policy may trigger another sweep. */
  #nextCleanupTime = 0;

  /**
   * Learn from the first STS header of an unfiltered network response.
   * hasValidTLS means authenticated secure transport without errors or warnings;
   * an HTTPS URL or a potentially trustworthy origin alone is insufficient.
   * now is the response reception time in integer milliseconds since the epoch.
   */
  processResponse(response: FetchResponse, hasValidTLS: boolean, now = Date.now()): void {
    const url = response.url;
    if (!hasValidTLS || url?.scheme !== 'https' || url.host?.kind !== 'domain') return;

    for (const [name, value] of response.headerList) {
      if (name.toLowerCase() !== 'strict-transport-security') continue;
      const policy = HSTSPolicy.parse(value);
      // A malformed first field is ignored, not replaced by a later field.
      if (policy === null) return;

      // Sweep at most once per minute of policy updates; lookup handles expiry immediately.
      if (now >= this.#nextCleanupTime) {
        this.removeExpiredHosts(now);
        this.#nextCleanupTime = now + 60_000;
      }

      // URL parsing already supplies IDNA conversion and ASCII case folding.
      const domain = url.host.value.endsWith('.') ? url.host.value.slice(0, -1) : url.host.value;
      if (policy.maxAge === 0n) {
        this.hosts.delete(domain);
      } else {
        this.hosts.set(domain, {
          expiryTime: BigInt(now) + policy.maxAge * 1000n,
          includeSubDomains: policy.includeSubDomains,
        });
      }
      return;
    }
  }

  /** Whether a parsed URL host has an unexpired exact or inherited HTTPS requirement. */
  // RFC 6797 §§8.2–8.3. Ports and public-suffix boundaries do not limit inheritance.
  requiresHTTPS(host: Host | null, now = Date.now()): boolean {
    if (host?.kind !== 'domain') return false;
    let domain = host.value.endsWith('.') ? host.value.slice(0, -1) : host.value;
    const time = BigInt(now);
    let exact = true;

    while (true) {
      const policy = this.hosts.get(domain);
      if (policy !== undefined) {
        if (policy.expiryTime < time) this.hosts.delete(domain);
        else if (exact || policy.includeSubDomains) return true;
      }
      const dot = domain.indexOf('.');
      if (dot === -1) return false;
      domain = domain.slice(dot + 1);
      exact = false;
    }
  }

  /** Evict every host whose policy's expiry time is in the past. */
  // https://www.rfc-editor.org/rfc/rfc6797.html#section-8.1.1
  removeExpiredHosts(now = Date.now()): void {
    const time = BigInt(now);
    for (const [domain, host] of this.hosts) {
      if (host.expiryTime < time) this.hosts.delete(domain);
    }
  }
}

/** The lifetime and subdomain directive from one valid STS field value. */
// https://www.rfc-editor.org/rfc/rfc6797.html#section-6.1
export class HSTSPolicy {
  /** Nonnegative lifetime in seconds; zero requests removal of remembered state. */
  maxAge: bigint;
  /** Whether the host's policy also protects its subdomains. */
  includeSubDomains: boolean;

  constructor(maxAge: bigint, includeSubDomains = false) {
    this.maxAge = maxAge;
    this.includeSubDomains = includeSubDomains;
  }

  /** Parse an unfolded HTTP field value, returning null when the complete policy is invalid. */
  static parse(input: string): HSTSPolicy | null {
    const cursor = new TextCursor(input);
    const names = new Set<string>();
    let maxAge: bigint | undefined;
    let includeSubDomains = false;

    while (!cursor.eof()) {
      cursor.consumeWhile(isHTTPTabOrSpace);
      // RFC 6797 permits empty directives, including leading/trailing semicolons.
      if (cursor.match(';')) continue;
      if (cursor.eof()) break;

      const start = cursor.pos();
      cursor.consumeWhile(isHTTPToken);
      const name = cursor.slice(start).toLowerCase();
      if (!name || names.has(name)) return null;
      names.add(name);
      cursor.consumeWhile(isHTTPTabOrSpace);

      let value: string | undefined;
      if (cursor.match('=')) {
        cursor.consumeWhile(isHTTPTabOrSpace);
        if (cursor.match('"')) {
          value = '';
          while (true) {
            if (cursor.eof()) return null;
            let ch = cursor.next();
            if (ch === '"') break;
            if (ch === '\\') {
              // RFC 2616's quoted-pair escapes one ASCII character.
              if (cursor.eof() || cursor.peek() > '\x7f') return null;
              ch = cursor.next();
            } else if (ch !== '\t' && (ch < ' ' || ch === '\x7f' || ch > '\xff')) {
              return null;
            }
            value += ch;
          }
        } else {
          const start = cursor.pos();
          cursor.consumeWhile(isHTTPToken);
          value = cursor.slice(start);
          if (value === '') return null;
        }
        cursor.consumeWhile(isHTTPTabOrSpace);
      }
      if (!cursor.eof() && !cursor.match(';')) return null;

      if (name === 'max-age') {
        if (value === undefined || value === '' || nonASCIIDigitPattern.test(value)) return null;
        maxAge = BigInt(value);
      } else if (name === 'includesubdomains') {
        if (value !== undefined) return null;
        includeSubDomains = true;
      }
    }

    return maxAge === undefined ? null : new HSTSPolicy(maxAge, includeSubDomains);
  }
}

/** Remembered state for one exact host; ports and paths do not affect its scope. */
export type HSTSHost = {
  /** Absolute expiry in epoch milliseconds, preserving unbounded RFC delta-seconds. */
  expiryTime: bigint;
  /** Whether matching may extend beyond this exact host to its subdomains. */
  includeSubDomains: boolean;
};
