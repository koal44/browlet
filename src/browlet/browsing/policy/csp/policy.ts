import { asciiLower } from '../../../../infra/ascii';
import { forgivingBase64Encode } from '../../../../infra/base64';
import { InternalError } from '../../../../infra/internal-error';
import { surroundingASCIIWhitespacePattern, asciiWhitespaceRunPattern } from '../../../../infra/patterns';
import { isomorphicDecode } from '../../../../js-engine/index';
import { applyIntegrityAlgorithm, isScriptLikeDestination, type FetchRequest, type FetchResponse } from '../../../../fetch/index';
import { stripURLForReporting, type Origin, type URLRecord } from '../../../../url/index';
import { CSPDirectives, CSPDirectiveValue, type CSPFetchDirectiveName } from './directives';
import { Environment, WindowEnvironment } from '../../../scripting/environment';
import { CSPViolation } from './violation';

const directiveNamePattern = /^[A-Za-z0-9-]+$/;
const invalidDirectiveCharacterPattern = /[^\t\n\f\r \x21-\x2B\x2D-\x3A\x3C-\x7E]/;

/** One independently enforced or monitored Content Security Policy. */
// https://w3c.github.io/webappsec-csp/#framework-policy
export class ContentSecurityPolicy {
  /** Directive names in insertion order, each retaining its whitespace-separated values. */
  directives = new CSPDirectives();
  /** Whether violations block the operation or only produce reports. */
  disposition: CSPDisposition;
  /** Whether the policy was delivered in a response header or a meta element. */
  source: CSPSource;
  /** Original policy text, retained for violation reports. */
  serialized = '';
  /** Developer warnings for the policy-delivery caller to send to its console. */
  parsingWarnings: string[] = [];

  constructor(source: CSPSource, disposition: CSPDisposition) {
    this.source = source;
    this.disposition = disposition;
  }

  /** Parse one policy, keeping the first occurrence of each directive name. */
  // https://w3c.github.io/webappsec-csp/#parse-serialized-policy
  static parse(serialized: string | Uint8Array, source: CSPSource, disposition: CSPDisposition): ContentSecurityPolicy {
    const policy = new ContentSecurityPolicy(source, disposition);
    policy.serialized = typeof serialized === 'string' ? serialized : isomorphicDecode(serialized);
    for (const part of policy.serialized.split(';')) {
      const token = part.replace(surroundingASCIIWhitespacePattern, '');
      // SPEC_CLASH(csp-directive-recovery): Keep valid sibling directives,
      // following browser recovery rather than rejecting the whole header.
      // The grammar also excludes ASCII controls and punctuation in names;
      // the draft's parsing steps explicitly reject only non-ASCII tokens.
      if (token === '' || invalidDirectiveCharacterPattern.test(token)) continue;
      const tokens = token.split(asciiWhitespaceRunPattern);
      const name = tokens.shift()!;
      if (!directiveNamePattern.test(name)) continue;
      const directiveName = asciiLower(name);
      if (policy.directives.has(directiveName)) {
        policy.parsingWarnings.push(`Ignoring duplicate Content Security Policy directive '${directiveName}'.`);
        continue;
      }
      // Unknown names remain inert until a directive algorithm recognizes them.
      policy.directives.set(directiveName, new CSPDirectiveValue(tokens));
    }
    return policy;
  }

  /** Identify the source directive that rejects this request, regardless of disposition. */
  // https://w3c.github.io/webappsec-csp/#does-request-violate-policy
  getViolatedRequestDirective(request: FetchRequest, selfOrigin: Origin): CSPFetchDirectiveName | undefined {
    if (request.initiator === 'prefetch') return this.#getViolatedResourceHintDirective(request, selfOrigin);
    const requestDirective = CSPDirectives.getRequestDirective(request);
    if (requestDirective === null) return undefined;
    const policyDirective = this.directives.getFetchDirective(requestDirective);
    if (policyDirective === undefined) return undefined;
    return this.#allowsRequestURL(request, request.currentURL, policyDirective, requestDirective, selfOrigin)
      ? undefined : policyDirective;
  }

  /** Check the response's URL, retaining nonce/hash authorization from the request. */
  // https://w3c.github.io/webappsec-csp/#should-block-response
  getViolatedResponseDirective(
    request: FetchRequest, response: FetchResponse, selfOrigin: Origin,
  ): CSPFetchDirectiveName | undefined {
    const requestDirective = CSPDirectives.getRequestDirective(request);
    if (requestDirective === null) return undefined;
    const policyDirective = this.directives.getFetchDirective(requestDirective);
    if (policyDirective === undefined) return undefined;
    if ((policyDirective === 'script-src' || requestDirective === 'script-src-elem') &&
      isScriptLikeDestination(request.destination)) {
      this.#potentiallyReportHash(response, request, policyDirective);
    }
    return this.#allowsRequestURL(request, response.url, policyDirective, requestDirective, selfOrigin)
      ? undefined : policyDirective;
  }

  /** Capture the requesting client's violation, without exposing redirected resource URLs. */
  // https://w3c.github.io/webappsec-csp/#create-violation-for-request
  createViolationForRequest(request: FetchRequest): CSPViolation {
    const env = request.client;
    const requestDirective = CSPDirectives.getRequestDirective(request);
    // Fetch accepts other hosts' environments; this CSP implementation belongs to HTML.
    if (!(env instanceof Environment)) throw new InternalError('CSP violation reporting requires a browser client');
    if (requestDirective === null) throw new InternalError('CSP violation requires a request directive');
    return new CSPViolation(this, requestDirective, request.url, env);
  }

  // https://w3c.github.io/webappsec-csp/#does-resource-hint-violate-policy
  #getViolatedResourceHintDirective(request: FetchRequest, selfOrigin: Origin): 'default-src' | undefined {
    if (!this.directives.has('default-src')) return undefined;
    // SPEC_CLASH(csp-resource-hint-matching): Include default-src's own list
    // and recognize a successful match; the draft omits it and tests 'Allowed'
    // against an algorithm returning 'Matches'. Chromium uses fallback here.
    for (const name of resourceHintDirectives) {
      const sources = this.directives.get(name);
      if (sources !== undefined && sources.matchesURL(request.currentURL, selfOrigin, request.redirectCount)) {
        return undefined;
      }
    }
    return 'default-src';
  }

  #allowsRequestURL(
    request: FetchRequest, url: URLRecord | null, policyDirective: CSPFetchDirectiveName,
    requestDirective: CSPFetchDirectiveName, selfOrigin: Origin,
  ): boolean {
    const sources = this.directives.get(policyDirective)!;
    // script-src has its own checks even when serving as worker-src's fallback.
    // default-src and child-src instead delegate to the request directive's checks.
    if ((policyDirective === 'script-src' || requestDirective === 'script-src-elem') &&
      isScriptLikeDestination(request.destination)) {
      if (sources.matchesNonce(request.cryptographicNonceMetadata) ||
        sources.matchesIntegrityMetadata(request.integrityMetadata)) return true;
      if (sources.tokens.some((source) => asciiLower(source) === "'strict-dynamic'")) return request.parserInserted !== true;
    } else if (requestDirective === 'style-src-elem') {
      if (sources.matchesNonce(request.cryptographicNonceMetadata)) return true;
    } else if (requestDirective === 'connect-src' && request.mode === 'webtransport' && request.webTransportHashList.length !== 0) {
      return sources.tokens.some((source) => asciiLower(source) === "'unsafe-webtransport-hashes'");
    }
    return url !== null && sources.matchesURL(url, selfOrigin, request.redirectCount);
  }

  // https://w3c.github.io/webappsec-csp/#potentially-report-hash
  #potentiallyReportHash(response: FetchResponse, request: FetchRequest, policyDirective: CSPFetchDirectiveName): void {
    const sources = this.directives.get(policyDirective)!;
    const algorithm = sources.tokens.includes("'report-sha512'") ? 'sha512' :
      sources.tokens.includes("'report-sha384'") ? 'sha384' : sources.tokens.includes("'report-sha256'") ? 'sha256' : undefined;
    if (algorithm === undefined) return;
    const env = request.client;
    const reportTo = this.directives.get('report-to')?.tokens;
    if (!(env instanceof WindowEnvironment) || !env.userAgent.reportDeliveryEnabled ||
      reportTo === undefined || reportTo.length === 0 || response.type === 'error') return;

    // Capture attribution before the asynchronous read, retaining the original URL.
    // SPEC_CLASH(csp-hash-resource-url): The draft serializes request.url unchanged;
    // sanitize credentials and fragments as Blink and WebKit do.
    const body = {
      documentURL: stripURLForReporting(env.window.document.url),
      subresourceURL: stripURLForReporting(request.url),
      hash: '', destination: request.destination, type: 'subresource',
    };
    const endpoints = [...reportTo];
    const report = (hash: string) => {
      body.hash = hash;
      for (const endpoint of endpoints) env.queueReport('csp-hash', endpoint, body);
    };

    // SPEC_CLASH(csp-hash-response-tainting): Fetch passes its internal response
    // to CSP, hiding opaque filtering from the draft's response-type check.
    // Also check the request's tainting so the report cannot disclose that digest.
    if (request.responseTainting === 'opaque' || response.type === 'opaque' || response.type === 'opaqueredirect') {
      report('');
      return;
    }
    const reportBytes = (bytes: Uint8Array) =>
      report(`${algorithm}-${forgivingBase64Encode(applyIntegrityAlgorithm(algorithm, bytes))}`);
    if (response.body === null) {
      reportBytes(new Uint8Array(0));
      return;
    }

    // SPEC_CLASH(csp-hash-body-reading): The draft passes a Fetch body to SRI's
    // byte algorithm without defining a completed-body read. Hash a separate
    // branch after completion, preserving the consumer's body and skipping errors.
    // TODO: Reuse loader/SRI completed bytes or digests when those consumers exist.
    response.body.clone().readAll(reportBytes, () => {}, env.global);
  }

  /** Copy directive data without sharing mutable maps or value lists. */
  clone(): ContentSecurityPolicy {
    const copy = new ContentSecurityPolicy(this.source, this.disposition);
    copy.serialized = this.serialized;
    copy.parsingWarnings = [...this.parsingWarnings];
    copy.directives = this.directives.clone();
    return copy;
  }
}

/** Enforcement and monitoring are independent for each policy in a CSP list. */
export type CSPDisposition = 'enforce' | 'report';

/** Delivery mechanism, used by the directive-specific restrictions. */
export type CSPSource = 'header' | 'meta';

const resourceHintDirectives: CSPFetchDirectiveName[] = [
  'default-src', 'child-src', 'connect-src', 'font-src', 'frame-src', 'img-src',
  'manifest-src', 'media-src', 'object-src', 'script-src', 'script-src-elem',
  'style-src', 'style-src-elem', 'worker-src',
];
