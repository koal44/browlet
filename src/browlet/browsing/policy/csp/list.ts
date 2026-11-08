import { InternalError, asciiLower } from '../../../../infra/index';
import { copyOrigin, obtainURLOrigin, parseURL, serializeURL, type Origin, type URLRecord } from '../../../../url/index';
import type { FetchCSPList, FetchRequest, FetchResponse } from '../../../../fetch/index';

import { SandboxingFlagSet } from '../sandbox/index';
import type { DocumentImpl, ElementImpl } from '../../../dom/nodes/index';
import type { BrowletEnvironment } from '../../../environment/index';
import type { Navigable } from '../../navigation/index';
import type { WorkerGlobalImpl } from '../../../workers/index';
import type { UserAgent } from '../../../user-agent';

import { ContentSecurityPolicy, type ContentSecurityPolicySnapshot, type CSPDisposition } from './policy';
import type { CSPInlineAttributeType } from './directives';
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

  /** Restore policy behavior in this isolate while retaining the original meaning of 'self'. */
  static fromSnapshot(snapshot: CSPListSnapshot): CSPList {
    const list = new CSPList(copyOrigin(snapshot.selfOrigin));
    list.policies = snapshot.policies.map((policy) => ContentSecurityPolicy.fromSnapshot(policy));
    return list;
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
        this.#reportRequestViolation(policy, request);
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
        this.#reportRequestViolation(policy, request);
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
        this.#reportRequestViolation(policy, request);
        if (policy.disposition === 'enforce') blocked = true;
      }
    }
    return blocked;
  }

  /** Check captured navigation policies; Trusted Types can rewrite the request before inline checks. */
  // https://w3c.github.io/webappsec-csp/#should-block-navigation-request
  isNavigationRequestBlocked(
    request: FetchRequest, type: 'form-submission' | 'other', env: BrowletEnvironment | null, redirectURL?: URLRecord,
  ): boolean {
    if (this.policies.length === 0) return false;
    if (env === null) throw new InternalError('Navigation CSP checks require the source client environment');
    // SPEC_CLASH(navigation-redirect-csp-url): HTML checks before Fetch advances the request URL.
    // Check the pending redirect as Chromium/WebKit do; Firefox only checks the initial form target (CSP #8).
    const url = redirectURL ?? request.currentURL;
    const redirectCount = request.redirectCount + (redirectURL === undefined ? 0 : 1);
    let blocked = false;
    let trustedTypesBlocked: boolean | undefined;
    let trustedTypesSample = '';
    for (const policy of this.policies) {
      for (const [name, value] of policy.directives) {
        let violation: CSPViolation;
        if (name === 'form-action') {
          if (type !== 'form-submission' || value.matchesURL(url, this.selfOrigin, redirectCount)) continue;
          violation = CSPViolation.fromGlobal(policy, name, request.url, env);
        } else if (name === 'require-trusted-types-for' && request.url.scheme === 'javascript') {
          // SPEC_CLASH(trusted-types-navigation-policies): Browsers require a valid 'script' token
          // and invoke the default policy once across policies; the written loop repeats it per directive.
          if (!value.tokens.some((token) => asciiLower(token) === "'script'")) continue;
          if (trustedTypesBlocked === undefined) {
            trustedTypesSample = `Location href|${serializeURL(request.url).slice(11, 51)}`;
            trustedTypesBlocked = this.#isTrustedTypesNavigationBlocked(request, env);
          }
          if (!trustedTypesBlocked) continue;
          // SPEC_CLASH(trusted-types-navigation-report): Follow all three browsers' sink resource/sample;
          // CSP's generic pre-navigation report instead uses the URL and leaves the sample empty (TT #584).
          violation = CSPViolation.fromGlobal(policy, name, 'trusted-types-sink', env);
          violation.sample = trustedTypesSample;
        } else {
          continue;
        }
        violation.report();
        if (policy.disposition === 'enforce') blocked = true;
      }
    }
    if (blocked || request.currentURL.scheme !== 'javascript') return blocked;

    // SPEC_CLASH(javascript-csp-encoding): Hash the full serialized URL, as CSP/Firefox/WebKit do;
    // Chromium percent-decodes it first. Nonces cannot authorize a navigation.
    const source = serializeURL(request.currentURL);
    // SPEC_CLASH(javascript-trusted-types-order): Follow CSP/Firefox: check the rewritten URL after
    // the default policy; Chromium/WebKit can reject the original URL before invoking that policy.
    for (const policy of this.policies) {
      const sources = policy.directives.get('script-src-elem') ??
        policy.directives.get('script-src') ?? policy.directives.get('default-src');
      if (sources === undefined || sources.matchesInlineSource('navigation', source)) continue;
      const violation = CSPViolation.fromGlobal(policy, 'script-src-elem', 'inline', env);
      // SPEC_CLASH(javascript-csp-sample): Browsers honor report-sample despite the navigation algorithm's
      // omission. Keep 40 encoded code units like WebKit; Chromium decodes and Firefox appends an ellipsis.
      if (sources.tokens.includes("'report-sample'")) violation.sample = source.slice(0, 40);
      violation.report();
      if (policy.disposition === 'enforce') blocked = true;
    }
    return blocked;
  }

  /** Check response and source policies before admitting a navigation response. */
  // https://w3c.github.io/webappsec-csp/#should-block-navigation-response
  isNavigationResponseBlocked(
    _request: FetchRequest | null, response: FetchResponse, _type: 'form-submission' | 'other',
    target: Navigable, userAgent: UserAgent,
  ): boolean {
    let blocked = false;
    for (const policy of this.policies) {
      const directive = policy.getViolatedNavigationResponseDirective(response, target, 'response', this.selfOrigin);
      if (directive === undefined) continue;
      CSPViolation.fromNavigationResponse(policy, directive, response, userAgent).report();
      if (policy.disposition === 'enforce') blocked = true;
    }
    // The source-policy loop is a no-op: frame-ancestors allows "source", and all other directives default to Allowed.
    // SPEC_GAP(csp-navigation-response-null-request): HTML's synthetic responses have no request; omit source checks
    // without borrowing an existing Window's policy. Neither request nor navigation type affects today's response checks.
    return blocked;
  }

  /** Apply this list's initialization directives to an already-created Document. */
  // https://w3c.github.io/webappsec-csp/#run-document-csp-initialization
  applyDocumentInitializationDirectives(document: DocumentImpl): void {
    // SPEC_GAP(csp-style-src-initialization): CSP leaves style-src's CSSOM initialization as an unresolved issue.
    // SPEC_CLASH(csp-style-src-cssom-eval): The draft gates CSSOM string parsing on style-src 'unsafe-eval';
    // Browlet's existing behavior leaves CSSOM writes available, as Chromium, Firefox, and WebKit do.
    // No initialization hook is installed; stylesheet Fetch and inline-input checks remain separate.
    // https://github.com/w3c/webappsec-csp/issues/212
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

  /** Initialize a worker's policies, returning whether sandbox restrictions prohibit execution. */
  // https://w3c.github.io/webappsec-csp/#run-global-object-csp-initialization
  // https://w3c.github.io/webappsec-csp/#sandbox-init
  initializeWorker(global: WorkerGlobalImpl): boolean {
    let blocked = false;
    for (const policy of this.policies) {
      for (const warning of policy.parsingWarnings) global.env.reportConsoleWarning(warning);
      if (policy.disposition !== 'enforce') continue;
      if (policy.directives.has('upgrade-insecure-requests')) {
        global.env.insecureRequestsPolicy.enableFor(global.env.apiBaseURL);
      }
      const sandbox = policy.directives.get('sandbox');
      // sandbox has no effect when delivered through a meta element, including
      // such a policy inherited by a local worker from its owner.
      if (sandbox === undefined || policy.source !== 'header') continue;
      const flags = SandboxingFlagSet.parse(sandbox.tokens.join(' '));
      if (flags.has('sandboxed-scripts') || flags.has('sandboxed-origin')) blocked = true;
    }
    return blocked;
  }

  /** Sandbox restrictions supplied by enforced response policies, before origin selection. */
  // https://html.spec.whatwg.org/multipage/browsers.html#forced-sandboxing-flag-set
  getSandboxingFlags(): SandboxingFlagSet {
    const flags = new SandboxingFlagSet();
    // SPEC_CLASH(csp-sandbox-combination): All three engines combine restrictions;
    // HTML's written algorithm instead selects the last enforced sandbox directive.
    for (const policy of this.policies) {
      if (policy.disposition !== 'enforce' || policy.source !== 'header') continue;
      const tokens = policy.directives.get('sandbox')?.tokens;
      if (tokens === undefined) continue;
      for (const flag of SandboxingFlagSet.parse(tokens.join(' '))) flags.add(flag);
    }
    return flags;
  }

  /** Whether base-uri blocks the URL; also report monitored violations without blocking. */
  // https://w3c.github.io/webappsec-csp/#allow-base-for-document
  isBaseBlocked(base: URLRecord, document: DocumentImpl): boolean {
    for (const policy of this.policies) {
      const sources = policy.directives.get('base-uri');
      if (sources === undefined || sources.matchesURL(base, this.selfOrigin, 0)) continue;
      CSPViolation.fromGlobal(policy, 'base-uri', 'inline', document.env).report();
      if (policy.disposition === 'enforce') return true;
    }
    return false;
  }

  /** Report every rejected inline attribute; true means an enforcing policy blocks its behavior. */
  // https://w3c.github.io/webappsec-csp/#should-block-inline
  // Attribute consumers only; script/style element bodies still need their own checks.
  isInlineAttributeBlocked(element: ElementImpl, type: CSPInlineAttributeType, source: string): boolean {
    const scriptAttribute = type === 'script-attr';
    const directive = scriptAttribute ? 'script-src-attr' : 'style-src-attr';
    const fallback = scriptAttribute ? 'script-src' : 'style-src';
    let blocked = false;
    for (const policy of this.policies) {
      // https://w3c.github.io/webappsec-csp/#directive-fallback-list
      const sources = policy.directives.get(directive) ??
        policy.directives.get(fallback) ?? policy.directives.get('default-src');
      if (sources === undefined || sources.matchesInlineSource(type, source)) continue;
      const violation = CSPViolation.fromGlobal(policy, directive, 'inline', element.nodeDocument.env);
      violation.element = element;
      // SPEC_CLASH(csp-style-attribute-sample): Follow CSP/Chromium/Firefox;
      // WebKit currently omits style-attribute samples despite report-sample.
      if (sources.tokens.includes("'report-sample'")) violation.sample = source.slice(0, 40);
      violation.report();
      if (policy.disposition === 'enforce') blocked = true;
    }
    return blocked;
  }

  /** Check compilation source lists and report violations; only enforcing policies block. */
  // https://w3c.github.io/webappsec-csp/#can-compile-strings
  // Source-list portion only: the preceding Trusted Types validation still needs
  // engine inputs absent from the native callback. Return a denial flag so the
  // engine creates EvalError in the compilation realm.
  isStringCompilationBlocked(source: string, env: BrowletEnvironment): boolean {
    const trustedTypesRequired = this.doesSinkTypeRequireTrustedTypes('script', false);
    let blocked = false;
    for (const policy of this.policies) {
      const sources = policy.directives.get('script-src') ?? policy.directives.get('default-src');
      if (sources === undefined || sources.tokens.some((token) => {
        const keyword = asciiLower(token);
        return keyword === "'unsafe-eval'" || (trustedTypesRequired && keyword === "'trusted-types-eval'");
      })) continue;
      const violation = CSPViolation.fromGlobal(policy, 'script-src', 'eval', env);
      if (sources.tokens.includes("'report-sample'")) violation.sample = source.slice(0, 40);
      violation.report();
      if (policy.disposition === 'enforce') blocked = true;
    }
    return blocked;
  }

  /** Report every Wasm compilation violation; only enforcing policies block. */
  // https://w3c.github.io/webappsec-csp/#can-compile-wasm-bytes
  // Return the denial flag to the engine, which creates CompileError in the compilation realm.
  isWasmCompilationBlocked(env: BrowletEnvironment): boolean {
    let blocked = false;
    for (const policy of this.policies) {
      const sources = policy.directives.get('script-src') ?? policy.directives.get('default-src');
      if (sources === undefined || sources.tokens.some((token) => {
        const keyword = asciiLower(token);
        return keyword === "'unsafe-eval'" || keyword === "'wasm-unsafe-eval'";
      })) continue;
      CSPViolation.fromGlobal(policy, 'script-src', 'wasm-eval', env).report();
      if (policy.disposition === 'enforce') blocked = true;
    }
    return blocked;
  }

  /** Whether any applicable policy requires a trusted value for this sink group. */
  // https://w3c.github.io/trusted-types/dist/spec/#does-sink-require-trusted-types
  doesSinkTypeRequireTrustedTypes(sinkGroup: string, includeReportOnlyPolicies: boolean): boolean {
    if (sinkGroup !== 'script') return false;
    return this.policies.some((policy) =>
      (includeReportOnlyPolicies || policy.disposition === 'enforce') &&
      policy.directives.get('require-trusted-types-for')?.tokens.some((token) => asciiLower(token) === "'script'"),
    );
  }

  /** Report every failed sink requirement; any enforcing violation blocks the assignment. */
  // https://w3c.github.io/trusted-types/dist/spec/#should-block-sink-type-mismatch
  isTrustedTypeSinkMismatchBlocked(sink: string, sinkGroup: string, source: string, env: BrowletEnvironment): boolean {
    if (sinkGroup !== 'script') return false;
    const sample = sink === 'Function' ? source.replace(/^(?:async )?function\*? anonymous/, '') : source;
    let blocked = false;
    for (const policy of this.policies) {
      const tokens = policy.directives.get('require-trusted-types-for')?.tokens;
      if (!tokens?.some((token) => asciiLower(token) === "'script'")) continue;
      const violation = CSPViolation.fromGlobal(policy, 'require-trusted-types-for', 'trusted-types-sink', env);
      violation.sample = `${sink}|${sample.slice(0, 40)}`;
      violation.report();
      if (policy.disposition === 'enforce') blocked = true;
    }
    return blocked;
  }

  /** Report policy-creation violations for both dispositions; any enforcing violation blocks. */
  // https://w3c.github.io/trusted-types/dist/spec/#should-block-create-policy
  // The owning environment supplies the global's violation-reporting context.
  isTrustedTypePolicyCreationBlocked(
    policyName: string, createdPolicyNames: ReadonlySet<string>, env: BrowletEnvironment,
  ): boolean {
    let blocked = false;
    for (const policy of this.policies) {
      const tokens = policy.directives.get('trusted-types')?.tokens;
      if (tokens === undefined) continue;
      const allowsDuplicates = tokens.some((token) => asciiLower(token) === "'allow-duplicates'");
      const allowsName = tokens.includes('*') ||
        tokens.some((token) => trustedTypePolicyNamePattern.test(token) && token === policyName);
      // 'none' cannot match a policy name; alongside other expressions it adds no restriction.
      // SPEC_CLASH(trusted-types-policy-creation): Follow the spec and Firefox's CSP checks.
      // Chromium/WebKit also reject unusual wildcard names and duplicate "default" through CSP.
      // The factory separately rejects a second default policy after these checks.
      if (allowsName && (!createdPolicyNames.has(policyName) || allowsDuplicates)) continue;
      const violation = CSPViolation.fromGlobal(policy, 'trusted-types', 'trusted-types-policy', env);
      violation.sample = policyName.slice(0, 40);
      violation.report();
      if (policy.disposition === 'enforce') blocked = true;
    }
    return blocked;
  }

  /** Copy policy values for host transport without retaining mutable origin or directive records. */
  toSnapshot(): CSPListSnapshot {
    return {
      selfOrigin: copyOrigin(this.selfOrigin),
      policies: this.policies.map((policy) => policy.toSnapshot()),
    };
  }

  /** Copy policy data while preserving the origin used by inherited 'self' checks. */
  clone(): CSPList {
    const copy = new CSPList(this.selfOrigin);
    copy.policies = this.policies.map((policy) => policy.clone());
    return copy;
  }

  // https://w3c.github.io/trusted-types/dist/spec/#require-trusted-types-for-pre-navigation-check
  #isTrustedTypesNavigationBlocked(request: FetchRequest, env: BrowletEnvironment): boolean {
    // SPEC_CLASH(javascript-trusted-types-encoding): Follow Trusted Types/Firefox's encoded input;
    // Chromium/WebKit percent-decode before invoking the default policy.
    const source = serializeURL(request.url).slice(11);
    let converted: string | null;
    try {
      converted = env.getWindowOrWorkerGlobalScopeMixin().trustedTypes
        .processValueWithDefaultPolicy('TrustedScript', source, 'Location href');
    } catch {
      // SPEC_CLASH(trusted-types-navigation-exception): Follow CSP/Firefox/WebKit: report the failure,
      // and let disposition decide blocking. Chromium stops even report-only navigation without reporting.
      return true;
    }
    if (converted === null) return true;
    const url = parseURL(`javascript:${converted}`).url;
    if (url === null) return true;
    request.urlList[0] = url;
    return false;
  }

  #reportRequestViolation(policy: ContentSecurityPolicy, request: FetchRequest): void {
    const client = request.client;
    if (client === null) throw new InternalError('CSP violation reporting requires a client');
    client.reportCSPViolation(policy, request);
  }
}

/** Copied policies and their inherited origin, independent of any environment or reporting service. */
export interface CSPListSnapshot {
  selfOrigin: Origin;
  policies: ContentSecurityPolicySnapshot[];
}

// https://w3c.github.io/trusted-types/dist/spec/#trusted-types-csp-directive
const trustedTypePolicyNamePattern = /^[a-zA-Z0-9\-#=_/@.%]+$/;
