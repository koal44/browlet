import { asciiLower } from '../../../../infra/ascii';
import { forgivingBase64Encode } from '../../../../infra/base64';
import { InternalError } from '../../../../infra/internal-error';
import { surroundingASCIIWhitespacePattern, asciiWhitespaceRunPattern } from '../../../../infra/patterns';
import { isomorphicDecode } from '../../../../js-engine/index';
import { applyIntegrityAlgorithm, isScriptLikeDestination, type FetchRequest, type FetchResponse } from '../../../../fetch/index';
import { stripURLForReporting, type Origin, type URLRecord } from '../../../../url/index';
import { getDirectiveFallbackList, getEffectiveDirective, type CSPFetchDirective } from './directives';
import { integrityMetadataMatchesSourceList, nonceMatchesSourceList, urlMatchesSourceList } from './source-list';
import { Environment, WindowEnvironment } from '../../../scripting/environment';
import { CSPViolation } from './violation';

const directiveNamePattern = /^[A-Za-z0-9-]+$/;
const invalidDirectiveCharacterPattern = /[^\t\n\f\r \x21-\x2B\x2D-\x3A\x3C-\x7E]/;

/** One independently enforced or monitored Content Security Policy. */
// https://w3c.github.io/webappsec-csp/#framework-policy
export class ContentSecurityPolicy {
  /** Directive names in insertion order, each retaining its whitespace-separated values. */
  directives: Map<string, string[]> = new Map();
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
      const [name, ...value] = token.split(asciiWhitespaceRunPattern);
      if (!directiveNamePattern.test(name!)) continue;
      const directiveName = asciiLower(name!);
      if (policy.directives.has(directiveName)) {
        policy.parsingWarnings.push(`Ignoring duplicate Content Security Policy directive '${directiveName}'.`);
        continue;
      }
      // Unknown names remain inert until a directive algorithm recognizes them.
      policy.directives.set(directiveName, value);
    }
    return policy;
  }

  /** Identify the source directive that rejects this request, regardless of disposition. */
  // https://w3c.github.io/webappsec-csp/#does-request-violate-policy
  getViolatedRequestDirective(request: FetchRequest, selfOrigin: Origin): CSPFetchDirective | undefined {
    if (request.initiator === 'prefetch') return this.getViolatedResourceHintDirective(request, selfOrigin);
    const effective = getEffectiveDirective(request);
    if (effective === null) return undefined;
    const directive = this.getFetchDirective(effective);
    if (directive === undefined) return undefined;
    return this.allowsRequestURL(request, request.currentURL, directive, effective, selfOrigin) ? undefined : directive;
  }

  /** Check the response's URL, retaining nonce/hash authorization from the request. */
  // https://w3c.github.io/webappsec-csp/#should-block-response
  getViolatedResponseDirective(
    request: FetchRequest, response: FetchResponse, selfOrigin: Origin,
  ): CSPFetchDirective | undefined {
    const effective = getEffectiveDirective(request);
    if (effective === null) return undefined;
    const directive = this.getFetchDirective(effective);
    if (directive === undefined) return undefined;
    if ((directive === 'script-src' || effective === 'script-src-elem') && isScriptLikeDestination(request.destination)) {
      this.potentiallyReportHash(response, request, directive);
    }
    return this.allowsRequestURL(request, response.url, directive, effective, selfOrigin) ? undefined : directive;
  }

  /** Select the first present directive in the effective directive's fallback chain. */
  // https://w3c.github.io/webappsec-csp/#should-directive-execute
  getFetchDirective(effective: CSPFetchDirective): CSPFetchDirective | undefined {
    return getDirectiveFallbackList(effective).find((name) => this.directives.has(name));
  }

  /** Capture the requesting client's violation, without exposing redirected resource URLs. */
  // https://w3c.github.io/webappsec-csp/#create-violation-for-request
  createViolationForRequest(request: FetchRequest): CSPViolation {
    const env = request.client;
    const directive = getEffectiveDirective(request);
    // Fetch accepts other hosts' environments; this CSP implementation belongs to HTML.
    if (!(env instanceof Environment)) throw new InternalError('CSP violation reporting requires a browser client');
    if (directive === null) throw new InternalError('CSP violation requires an effective directive');
    return new CSPViolation(this, directive, request.url, env);
  }

  // https://w3c.github.io/webappsec-csp/#does-resource-hint-violate-policy
  private getViolatedResourceHintDirective(request: FetchRequest, selfOrigin: Origin): 'default-src' | undefined {
    if (!this.directives.has('default-src')) return undefined;
    // SPEC_CLASH(csp-resource-hint-matching): Include default-src's own list
    // and recognize a successful match; the draft omits it and tests 'Allowed'
    // against an algorithm returning 'Matches'. Chromium uses fallback here.
    for (const name of resourceHintDirectives) {
      const sources = this.directives.get(name);
      if (sources !== undefined && urlMatchesSourceList(request.currentURL, sources, selfOrigin, request.redirectCount)) {
        return undefined;
      }
    }
    return 'default-src';
  }

  private allowsRequestURL(
    request: FetchRequest, url: URLRecord | null, directive: CSPFetchDirective,
    effective: CSPFetchDirective, selfOrigin: Origin,
  ): boolean {
    const sources = this.directives.get(directive)!;
    // script-src has its own checks even when serving as worker-src's fallback.
    // default-src and child-src instead delegate to the effective directive.
    if ((directive === 'script-src' || effective === 'script-src-elem') && isScriptLikeDestination(request.destination)) {
      if (nonceMatchesSourceList(request.cryptographicNonceMetadata, sources) ||
        integrityMetadataMatchesSourceList(request.integrityMetadata, sources)) return true;
      if (sources.some((source) => asciiLower(source) === "'strict-dynamic'")) return request.parserInserted !== true;
    } else if (effective === 'style-src-elem') {
      if (nonceMatchesSourceList(request.cryptographicNonceMetadata, sources)) return true;
    } else if (effective === 'connect-src' && request.mode === 'webtransport' && request.webTransportHashList.length !== 0) {
      return sources.some((source) => asciiLower(source) === "'unsafe-webtransport-hashes'");
    }
    return url !== null && urlMatchesSourceList(url, sources, selfOrigin, request.redirectCount);
  }

  // https://w3c.github.io/webappsec-csp/#potentially-report-hash
  private potentiallyReportHash(response: FetchResponse, request: FetchRequest, directive: CSPFetchDirective): void {
    const sources = this.directives.get(directive)!;
    const algorithm = sources.includes("'report-sha512'") ? 'sha512' :
      sources.includes("'report-sha384'") ? 'sha384' : sources.includes("'report-sha256'") ? 'sha256' : undefined;
    if (algorithm === undefined) return;
    const env = request.client;
    const reportTo = this.directives.get('report-to');
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
    response.body.clone().fullyRead(reportBytes, () => {}, env.global);
  }

  /** Copy directive data without sharing mutable maps or value lists. */
  clone(): ContentSecurityPolicy {
    const copy = new ContentSecurityPolicy(this.source, this.disposition);
    copy.serialized = this.serialized;
    copy.parsingWarnings = [...this.parsingWarnings];
    for (const [name, value] of this.directives) copy.directives.set(name, [...value]);
    return copy;
  }
}

/** Enforcement and monitoring are independent for each policy in a CSP list. */
export type CSPDisposition = 'enforce' | 'report';

/** Delivery mechanism, used by the directive-specific restrictions. */
export type CSPSource = 'header' | 'meta';

const resourceHintDirectives: CSPFetchDirective[] = [
  'default-src', 'child-src', 'connect-src', 'font-src', 'frame-src', 'img-src',
  'manifest-src', 'media-src', 'object-src', 'script-src', 'script-src-elem',
  'style-src', 'style-src-elem', 'worker-src',
];
