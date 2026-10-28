import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { BrowletEnvironmentBase } from '../../../../src/browlet/environment';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { PolicyContainer } from '../../../../src/browlet/browsing/policy/container';
import { IntegrityPolicy } from '../../../../src/browlet/browsing/policy/integrity-policy';
import { CSPList } from '../../../../src/browlet/browsing/policy/csp/list';
import { ContentSecurityPolicy } from '../../../../src/browlet/browsing/policy/csp/policy';
import { FetchResponse } from '../../../../src/fetch/response';
import { BlobImpl } from '../../../../src/file/blob';
import { createOpaqueOrigin } from '../../../../src/url/origin';
import { parseURL } from '../../../../src/url/url';
import { unwrap } from '../../../support/browlet-binding';

describe('Policy containers', () => {
  it('associates a response Referrer-Policy with the destination document', () => {
    const browser = new Browlet({ route: () => '' });
    const navigable = unwrap<DocumentImpl>(browser.document).getNodeNavigable()!;
    const response = new FetchResponse();
    response.urlList.push(parseURL('https://destination.test/').url!);
    response.headerList.append('Referrer-Policy', 'origin, no-referrer');
    const params = navigable.createNavigationParams(response);
    const document = navigable.createAndInitializeDocument('html', 'text/html', params);
    expect(document.policyContainer.referrerPolicy).toBe('no-referrer');
  });

  it('creates independent default policy state', () => {
    const first = new PolicyContainer();
    const second = new UserAgent().createPolicyContainer();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.cspList).toBeUndefined();
    expect(first.embedderPolicy).not.toBe(second.embedderPolicy);
    expect(first.integrityPolicy).not.toBe(second.integrityPolicy);
    expect(first.reportOnlyIntegrityPolicy).not.toBe(second.reportOnlyIntegrityPolicy);
  });

  it.each([true, false, null])('creates response policies with secure-context decision %s', (isSecureContext) => {
    const response = makeResponse();
    response.headerList.append('Content-Security-Policy', "default-src 'self'");
    response.headerList.append('Content-Security-Policy-Report-Only', "img-src 'none'");
    response.headerList.append('Cross-Origin-Embedder-Policy', 'require-corp; report-to="enforced"');
    response.headerList.append('Cross-Origin-Embedder-Policy-Report-Only', 'credentialless; report-to="reported"');
    response.headerList.append('Referrer-Policy', 'origin, no-referrer');
    response.headerList.append('Integrity-Policy', 'blocked-destinations=(script)');
    response.headerList.append('Integrity-Policy-Report-Only', 'blocked-destinations=(style)');
    const url = response.url!;
    const userAgent = new UserAgent();
    const env = isSecureContext === null ? null : new BrowletEnvironmentBase({
      userAgent, creationURL: url, topLevelCreationURL: url, topLevelOrigin: createOpaqueOrigin(),
      targetBrowsingContext: null, isSecureContext,
    });
    const container = userAgent.createPolicyContainerFromResponse(response, env);
    expect(container.cspList!.policies.map((policy) => policy.disposition)).toEqual(['enforce', 'report']);
    expect(container.embedderPolicy).toEqual({
      value: isSecureContext ? 'require-corp' : 'unsafe-none',
      reportingEndpoint: isSecureContext ? 'enforced' : '',
      reportOnlyValue: isSecureContext ? 'credentialless' : 'unsafe-none',
      reportOnlyReportingEndpoint: isSecureContext ? 'reported' : '',
    });
    expect(container.referrerPolicy).toBe('no-referrer');
    expect(container.integrityPolicy.blockedDestinations).toEqual(['script']);
    expect(container.reportOnlyIntegrityPolicy.blockedDestinations).toEqual(['style']);
  });

  it('uses an empty referrer policy when the response supplies no policy header', () => {
    const container = new UserAgent().createPolicyContainerFromResponse(makeResponse(), null);
    expect(container.referrerPolicy).toBe('');
    expect(container.cspList!.policies).toEqual([]);
  });

  it('clones a retained Blob creator policy even after revocation, ignoring response headers', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const { env } = document;
    const store = env.userAgent.blobURLStore;
    const blobURL = store.add(new BlobImpl(['body'], {}, env), env);
    const response = new FetchResponse();
    response.urlList.push(env.parseURL(blobURL)!);
    store.remove(blobURL);
    document.policyContainer.referrerPolicy = 'no-referrer';
    document.policyContainer.embedderPolicy.value = 'credentialless';
    document.policyContainer.reportOnlyIntegrityPolicy.blockedDestinations.push('script');
    response.headerList.append('Referrer-Policy', 'unsafe-url');
    response.headerList.append('Cross-Origin-Embedder-Policy', 'unsafe-none');
    const container = env.userAgent.createPolicyContainerFromResponse(response, null);
    expect(container).toEqual(document.policyContainer);
    expect(container).not.toBe(document.policyContainer);
    expect(container.reportOnlyIntegrityPolicy).not.toBe(document.policyContainer.reportOnlyIntegrityPolicy);
    const navigable = document.getNodeNavigable()!;
    const params = navigable.createNavigationParams(response);
    const destination = navigable.createAndInitializeDocument('html', 'text/html', params);
    expect(destination.policyContainer.embedderPolicy.value).toBe('credentialless');
    expect(destination.policyContainer.referrerPolicy).toBe('no-referrer');
    expect(navigable.createHistoryEntry(destination, params).documentState.historyPolicyContainer).toBeNull();
  });

  it.each([
    ['about:blank', true], ['about:srcdoc', true], ['data:text/html,body', true],
    ['blob:https://creator.test/id', false], ['https://example.test/', false], ['file:///page.html', false],
  ] as const)('stores policies in history for %s: %s', (input, expected) => {
    expect(PolicyContainer.requiresStorageInHistory(parseURL(input).url!)).toBe(expected);
  });

  it('gives history precedence over srcdoc, initiator, and response policies', () => {
    const history = new PolicyContainer();
    history.referrerPolicy = 'no-referrer';
    const other = new PolicyContainer();
    const selected = PolicyContainer.determineForNavigation(parseURL('about:srcdoc').url!, history, other, other, other);
    expect(selected).toEqual(history);
    expect(selected).not.toBe(history);
    expect(() => PolicyContainer.determineForNavigation(makeResponse().url!, history, null, null, null))
      .toThrow('This URL cannot restore policies from history');
  });

  it.each(['about:srcdoc', 'about:srcdoc#fragment'])('clones the %s parent before considering an initiator or response', (input) => {
    const parent = new PolicyContainer();
    parent.referrerPolicy = 'same-origin';
    const other = new PolicyContainer();
    const url = parseURL(input).url!;
    const selected = PolicyContainer.determineForNavigation(url, null, other, parent, other);
    expect(selected).toEqual(parent);
    expect(selected).not.toBe(parent);
    expect(() => PolicyContainer.determineForNavigation(url, null, other, null, other))
      .toThrow('Srcdoc policy inheritance requires a parent policy container');
  });

  it.each(['about:blank', 'about:srcdoc?query', 'data:text/html,body', 'blob:https://creator.test/id'])(
    'clones the initiator for local URL %s', (input) => {
      const initiator = new PolicyContainer();
      initiator.referrerPolicy = 'no-referrer';
      const selected = PolicyContainer.determineForNavigation(
        parseURL(input).url!, null, initiator, new PolicyContainer(), new PolicyContainer(),
      );
      expect(selected).toEqual(initiator);
      expect(selected).not.toBe(initiator);
    },
  );

  it('retains response identity for a non-local URL and supplies fresh defaults without a response', () => {
    const response = new PolicyContainer();
    const initiator = new PolicyContainer();
    initiator.referrerPolicy = 'no-referrer';
    expect(PolicyContainer.determineForNavigation(makeResponse().url!, null, initiator, initiator, response)).toBe(response);
    const url = parseURL('about:blank').url!;
    expect(PolicyContainer.determineForNavigation(url, null, null, null, response)).toBe(response);
    const selected = PolicyContainer.determineForNavigation(url, null, null, null, null);
    expect(selected).toEqual(new PolicyContainer());
    expect(selected).not.toBe(PolicyContainer.determineForNavigation(url, null, null, null, null));
  });

  it('retains the live local-document container in history and clones it on reconstruction', () => {
    const browser = new Browlet({ route: () => '' });
    const navigable = unwrap<DocumentImpl>(browser.document).getNodeNavigable()!;
    const params = navigable.createNavigationParams(makeResponse('data:text/html,body'));
    const document = navigable.createAndInitializeDocument('html', 'text/html', params);
    const state = navigable.createHistoryEntry(document, params).documentState;
    expect(state.historyPolicyContainer).toBe(document.policyContainer);
    document.policyContainer.referrerPolicy = 'no-referrer';
    const restored = PolicyContainer.determineForNavigation(params.url, state.historyPolicyContainer, null, null, null);
    expect(restored.referrerPolicy).toBe('no-referrer');
    expect(restored).not.toBe(document.policyContainer);
  });

  it('associates both response policies with the container', () => {
    const response = new FetchResponse();
    response.headerList.append('Integrity-Policy', 'blocked-destinations=(script), endpoints=(enforced)');
    response.headerList.append('integrity-policy-report-only', 'blocked-destinations=(style), endpoints=(reported)');
    const container = new PolicyContainer();
    container.parseIntegrityPolicyHeaders(response);
    expect(container.integrityPolicy).toEqual({
      sources: ['inline'], blockedDestinations: ['script'], endpoints: ['enforced'],
    });
    expect(container.reportOnlyIntegrityPolicy).toEqual({
      sources: ['inline'], blockedDestinations: ['style'], endpoints: ['reported'],
    });
  });

  it('preserves existing policies when the response supplies neither header', () => {
    const container = new PolicyContainer();
    const enforced = container.integrityPolicy;
    const reported = container.reportOnlyIntegrityPolicy;
    enforced.blockedDestinations.push('script');
    reported.blockedDestinations.push('style');
    container.parseIntegrityPolicyHeaders(new FetchResponse());
    expect(container.integrityPolicy).toBe(enforced);
    expect(container.reportOnlyIntegrityPolicy).toBe(reported);
  });

  it.each([
    ['Integrity-Policy', 'integrityPolicy', 'reportOnlyIntegrityPolicy'],
    ['Integrity-Policy-Report-Only', 'reportOnlyIntegrityPolicy', 'integrityPolicy'],
  ] as const)('discards a malformed %s without changing the other policy', (header, field, otherField) => {
    const container = new PolicyContainer();
    container[field].blockedDestinations.push('script');
    const other = container[otherField];
    other.sources.push('inline');
    other.blockedDestinations.push('style');
    const response = new FetchResponse();
    response.headerList.append(header, 'blocked-destinations=(script), sources="inline"');
    container.parseIntegrityPolicyHeaders(response);
    expect(container[field]).toEqual(new IntegrityPolicy());
    expect(container[otherField]).toBe(other);
    expect(other.blockedDestinations).toEqual(['style']);
  });

  it('copies enforced and reporting COEP fields and referrer policy', () => {
    const original = new PolicyContainer();
    original.embedderPolicy.value = 'require-corp';
    original.embedderPolicy.reportingEndpoint = 'enforced';
    original.embedderPolicy.reportOnlyValue = 'credentialless';
    original.embedderPolicy.reportOnlyReportingEndpoint = 'reported';
    original.referrerPolicy = 'no-referrer';
    const copy = original.clone();
    expect(copy).toEqual(original);
    expect(copy.embedderPolicy).not.toBe(original.embedderPolicy);
    expect(copy.cspList).toBeUndefined();
    expect(copy.integrityPolicy).not.toBe(original.integrityPolicy);
    expect(copy.reportOnlyIntegrityPolicy).not.toBe(original.reportOnlyIntegrityPolicy);
    original.embedderPolicy.reportingEndpoint = 'changed';
    original.referrerPolicy = 'unsafe-url';
    expect(copy.embedderPolicy.reportingEndpoint).toBe('enforced');
    expect(copy.referrerPolicy).toBe('no-referrer');
    copy.embedderPolicy.value = 'unsafe-none';
    expect(original.embedderPolicy.value).toBe('require-corp');
  });

  it('copies populated CSP directives and preserves their self origin', () => {
    const original = new PolicyContainer();
    const origin = createOpaqueOrigin();
    original.cspList = new CSPList(origin);
    original.cspList.policies.push(
      ContentSecurityPolicy.parse("default-src 'self'", 'header', 'enforce'),
      ContentSecurityPolicy.parse("img-src 'none'", 'header', 'report'),
    );
    const copy = original.clone();
    expect(copy.cspList).toEqual(original.cspList);
    expect(copy.cspList!.selfOrigin).toBe(origin);
    expect(copy.cspList!.policies).not.toBe(original.cspList.policies);
    copy.cspList!.policies[0]!.directives.get('default-src')!.tokens.push('https://cdn.test');
    copy.cspList!.policies[1]!.directives.clear();
    copy.cspList!.policies.pop();
    expect(original.cspList.policies.map((policy) => [...policy.directives])).toEqual([
      [['default-src', { tokens: ["'self'"] }]], [['img-src', { tokens: ["'none'"] }]],
    ]);
  });

  it.each(['integrityPolicy', 'reportOnlyIntegrityPolicy'] as const)('copies populated %s independently', (field) => {
    const original = new PolicyContainer();
    original[field].sources.push('inline');
    original[field].blockedDestinations.push('script', 'style');
    original[field].endpoints.push('reports');
    const copy = original.clone();
    expect(copy[field]).toEqual(original[field]);
    copy[field].sources.length = 0;
    copy[field].blockedDestinations.length = 0;
    copy[field].endpoints.length = 0;
    expect(original[field]).toEqual({
      sources: ['inline'], blockedDestinations: ['script', 'style'], endpoints: ['reports'],
    });
  });
});

function makeResponse(url = 'https://resource.test/'): FetchResponse {
  const response = new FetchResponse();
  response.urlList.push(parseURL(url).url!);
  return response;
}
