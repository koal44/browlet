import { ContentSecurityPolicy, type CSPDisposition } from './policy';
import type { FetchCSPList, FetchRequest, FetchResponse } from '../../../../fetch/index';
import { InternalError } from '../../../../infra/internal-error';
import { obtainURLOrigin, type Origin, type URLRecord } from '../../../../url/index';
import type { DocumentImpl } from '../../../dom/nodes/document';
import { parseSandboxingDirective, type SandboxingFlagSet } from '../sandbox';
import { urlMatchesSourceList } from './source-list';
import { CSPViolation } from './violation';

const policyHeaders: [name: string, disposition: CSPDisposition][] = [
  ['Content-Security-Policy', 'enforce'],
  ['Content-Security-Policy-Report-Only', 'report'],
];

/** Policies sharing the origin against which their 'self' expressions are checked. */
// https://w3c.github.io/webappsec-csp/#csp-list
export class CSPList implements FetchCSPList {
  /** Policies applied independently, preserving delivery order within each disposition. */
  policies: ContentSecurityPolicy[] = [];
  /** Resource origin retained for 'self', including when the policies are inherited. */
  selfOrigin: Origin;

  constructor(selfOrigin: Origin) {
    this.selfOrigin = selfOrigin;
  }

  /** Parse response policies with the final response URL's origin for 'self'. */
  // https://w3c.github.io/webappsec-csp/#parse-response-csp
  static parse(response: FetchResponse): CSPList {
    const url = response.url;
    if (url === null) throw new InternalError('CSP response parsing requires a response URL');
    const list = new CSPList(obtainURLOrigin(url));
    for (const [header, disposition] of policyHeaders) {
      // CSP has no quoted-comma escape. Parse each comma-separated policy,
      // leaving malformed-directive recovery to its parser instead of
      // invalidating an entire field against the serialized-policy-list ABNF.
      const values = response.headerList.extractValues(header, (value) => value.split(','), true);
      for (const serialized of values ?? []) {
        const policy = ContentSecurityPolicy.parse(serialized, 'header', disposition);
        if (policy.directives.size !== 0) list.policies.push(policy);
      }
    }
    return list;
  }

  /** Whether any retained policy came from a response header. */
  // https://w3c.github.io/webappsec-csp/#contains-a-header-delivered-content-security-policy
  hasHeaderDeliveredPolicy(): boolean {
    return this.policies.some((policy) => policy.source === 'header');
  }

  /** Report monitored request violations before Fetch upgrades insecure URLs. */
  // https://w3c.github.io/webappsec-csp/#report-for-request
  reportRequestViolations(request: FetchRequest): void {
    for (const policy of this.policies) {
      if (policy.disposition !== 'report') continue;
      if (policy.getViolatedRequestDirective(request, this.selfOrigin) !== undefined) {
        policy.createViolationForRequest(request).report();
      }
    }
  }

  /** Check every enforcing policy; one violation blocks without suppressing later reports. */
  // https://w3c.github.io/webappsec-csp/#should-block-request
  isRequestBlocked(request: FetchRequest): boolean {
    let blocked = false;
    for (const policy of this.policies) {
      if (policy.disposition !== 'enforce') continue;
      if (policy.getViolatedRequestDirective(request, this.selfOrigin) !== undefined) {
        policy.createViolationForRequest(request).report();
        blocked = true;
      }
    }
    return blocked;
  }

  /** Check both dispositions after fetching; only an enforcing policy can block. */
  // https://w3c.github.io/webappsec-csp/#should-block-response
  isResponseBlocked(response: FetchResponse, request: FetchRequest): boolean {
    let blocked = false;
    for (const policy of this.policies) {
      if (policy.getViolatedResponseDirective(request, response, this.selfOrigin) !== undefined) {
        policy.createViolationForRequest(request).report();
        if (policy.disposition === 'enforce') blocked = true;
      }
    }
    return blocked;
  }

  /** Apply document initialization directives after the loader has selected its policy container. */
  // https://w3c.github.io/webappsec-csp/#run-document-csp-initialization
  initializeDocument(document: DocumentImpl): void {
    for (const policy of this.policies) {
      for (const warning of policy.parsingWarnings) {
        document.env.reportConsoleWarning(warning);
      }
      if (policy.disposition === 'enforce' && policy.directives.has('upgrade-insecure-requests')) {
        document.env.insecureRequestsPolicy.enableFor(document.url);
      }
      // sandbox affects origin selection before Document construction. Its CSP
      // initialization algorithm applies only to workers, not to Documents.
    }
  }

  /** Sandbox restrictions supplied by enforced response policies, before origin selection. */
  // https://html.spec.whatwg.org/multipage/browsers.html#forced-sandboxing-flag-set
  getSandboxingFlags(): SandboxingFlagSet {
    const flags: SandboxingFlagSet = new Set();
    // SPEC_CLASH(csp-sandbox-combination): All three engines combine restrictions;
    // HTML's written algorithm instead selects the last enforced sandbox directive.
    for (const policy of this.policies) {
      if (policy.disposition !== 'enforce' || policy.source !== 'header') continue;
      const tokens = policy.directives.get('sandbox');
      if (tokens === undefined) continue;
      for (const flag of parseSandboxingDirective(tokens.join(' '))) flags.add(flag);
    }
    return flags;
  }

  /** Whether base-uri blocks the URL; also report monitored violations without blocking. */
  // https://w3c.github.io/webappsec-csp/#allow-base-for-document
  isBaseBlocked(base: URLRecord, document: DocumentImpl): boolean {
    for (const policy of this.policies) {
      const sources = policy.directives.get('base-uri');
      if (sources === undefined || urlMatchesSourceList(base, sources, this.selfOrigin, 0)) continue;
      new CSPViolation(policy, 'base-uri', 'inline', document.env).report();
      if (policy.disposition === 'enforce') return true;
    }
    return false;
  }

  /** Copy policy data while preserving the origin used by inherited 'self' checks. */
  clone(): CSPList {
    const copy = new CSPList(this.selfOrigin);
    copy.policies = this.policies.map((policy) => policy.clone());
    return copy;
  }
}
