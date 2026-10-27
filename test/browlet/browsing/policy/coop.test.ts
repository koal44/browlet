import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import type { OpenerPolicyEnforcementResult } from '../../../../src/browlet/browsing/navigation/params';
import { EmbedderPolicy } from '../../../../src/browlet/browsing/policy/coep';
import { OpenerPolicy, sanitizeURLForReport, type OpenerPolicyValue } from '../../../../src/browlet/browsing/policy/coop';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { BrowletEnvironmentBase } from '../../../../src/browlet/environment';
import { FetchResponse } from '../../../../src/fetch/response';
import { createOpaqueOrigin } from '../../../../src/url/origin';
import { obtainURLOrigin, parseURL } from '../../../../src/url/url';
import { serializeURL } from '../../../../src/url/core/url';
import { unwrap } from '../../../support/browlet-binding';

describe('cross-origin opener policy headers', () => {
  let env: BrowletEnvironmentBase;
  beforeAll(() => {
    const browser = new Browlet({ route: () => '' });
    env = reserve(browser, makeResponse());
  });

  it.each<[string | null, OpenerPolicyValue, string | null]>([
    [null, 'unsafe-none', null],
    ['unsafe-none; report-to="default"', 'unsafe-none', 'default'],
    ['same-origin', 'same-origin', null],
    ['same-origin-allow-popups', 'same-origin-allow-popups', null],
    ['noopener-allow-popups', 'noopener-allow-popups', null],
    ['same-origin-plus-COEP; report-to="internal"', 'unsafe-none', 'internal'],
    ['unknown; report-to="errors"', 'unsafe-none', 'errors'],
    ['Same-Origin', 'unsafe-none', null],
    ['"same-origin"; report-to="errors"', 'unsafe-none', null],
    ['same-origin; report-to=errors', 'same-origin', null],
    ['same-origin; report-to=""', 'same-origin', ''],
    ['same-origin; report-to="first"; report-to="last"', 'same-origin', 'last'],
    ['same-origin, same-origin', 'unsafe-none', null],
    ['(same-origin)', 'unsafe-none', null],
    ['?1', 'unsafe-none', null],
    ['same-origin;', 'unsafe-none', null],
  ])('parses the structured item %j', (header, value, reportingEndpoint) => {
    const response = makeResponse();
    if (header !== null) response.headerList.append('Cross-Origin-Opener-Policy', header);
    expect(OpenerPolicy.obtain(response, env)).toMatchObject({ value, reportingEndpoint });
  });

  it('rejects repeated header fields combined into a list', () => {
    const response = makeResponse();
    response.headerList.append('Cross-Origin-Opener-Policy', 'same-origin');
    response.headerList.append('Cross-Origin-Opener-Policy', 'same-origin');
    expect(OpenerPolicy.obtain(response, env)).toEqual(new OpenerPolicy());
  });

  it.each(['same-origin', 'same-origin-allow-popups', 'noopener-allow-popups'])('parses report-only %s independently', (token) => {
    const response = makeResponse({
      'Cross-Origin-Opener-Policy': 'same-origin; report-to="enforced"',
      'Cross-Origin-Opener-Policy-Report-Only': `${token}; report-to="observed"`,
    });
    const policy = OpenerPolicy.obtain(response, env);
    expect(policy.reportOnlyValue).toBe(token === 'noopener-allow-popups' ? 'unsafe-none' : token);
    expect(policy.reportingEndpointForDisposition('enforce')).toBe('enforced');
    expect(policy.reportingEndpointForDisposition('reporting')).toBe('observed');
  });

  it('honors a report-only endpoint without an enforced endpoint', () => {
    const policy = OpenerPolicy.obtain(makeResponse({
      'Cross-Origin-Opener-Policy-Report-Only': 'same-origin; report-to="observed"',
    }), env);
    expect(policy.reportingEndpointForDisposition('reporting')).toBe('observed');
    expect(policy.reportingEndpointForDisposition('enforce')).toBeNull();
  });

  it.each([
    ['require-corp', null, 'same-origin-plus-COEP', 'same-origin-plus-COEP'],
    ['credentialless', null, 'same-origin-plus-COEP', 'same-origin-plus-COEP'],
    [null, 'require-corp', 'same-origin', 'same-origin-plus-COEP'],
    [null, 'credentialless', 'same-origin', 'same-origin-plus-COEP'],
    ['"require-corp"', 'unknown', 'same-origin', 'same-origin'],
  ])('combines enforced COEP %j and report-only COEP %j', (enforced, reportOnly, value, reportOnlyValue) => {
    const response = makeResponse({
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Opener-Policy-Report-Only': 'same-origin',
    });
    if (enforced !== null) response.headerList.append('Cross-Origin-Embedder-Policy', enforced);
    if (reportOnly !== null) response.headerList.append('Cross-Origin-Embedder-Policy-Report-Only', reportOnly);
    expect(OpenerPolicy.obtain(response, env)).toMatchObject({ value, reportOnlyValue });
  });

  it('ignores COOP and COEP in a non-secure reserved environment', () => {
    const response = makeResponse({
      'Cross-Origin-Opener-Policy': 'same-origin; report-to="enforced"',
      'Cross-Origin-Opener-Policy-Report-Only': 'same-origin; report-to="observed"',
      'Cross-Origin-Embedder-Policy': 'require-corp; report-to="enforced"',
      'Cross-Origin-Embedder-Policy-Report-Only': 'credentialless; report-to="observed"',
    });
    const insecureEnv = new BrowletEnvironmentBase(null);
    expect(OpenerPolicy.obtain(response, insecureEnv)).toEqual(new OpenerPolicy());
    expect(EmbedderPolicy.obtain(response, insecureEnv)).toEqual(new EmbedderPolicy());
  });

  it.each(['Cross-Origin-Embedder-Policy', 'Cross-Origin-Embedder-Policy-Report-Only'])('parses %s endpoints only for compatible policies', (header) => {
    const reportOnly = header.endsWith('Report-Only');
    for (const token of ['require-corp', 'credentialless', 'unsafe-none', 'unknown']) {
      const policy = EmbedderPolicy.obtain(makeResponse({ [header]: `${token}; report-to="errors"` }), env);
      expect(reportOnly ? policy.reportOnlyReportingEndpoint : policy.reportingEndpoint)
        .toBe(token === 'require-corp' || token === 'credentialless' ? 'errors' : '');
    }
  });
});

describe('cross-origin opener policy comparisons', () => {
  const origin = obtainURLOrigin(parseURL('https://a.example.com/').url!);
  const otherOrigin = obtainURLOrigin(parseURL('https://b.example.com/').url!);

  it.each<[OpenerPolicyValue, OpenerPolicyValue, boolean, boolean]>([
    ['unsafe-none', 'unsafe-none', false, true],
    ['unsafe-none', 'same-origin', true, false],
    ['same-origin', 'unsafe-none', true, false],
    ['same-origin', 'same-origin', true, true],
    ['same-origin', 'same-origin', false, false],
    ['same-origin', 'same-origin-plus-COEP', true, false],
    ['same-origin-allow-popups', 'same-origin-allow-popups', true, true],
    ['same-origin-allow-popups', 'same-origin-allow-popups', false, false],
    ['noopener-allow-popups', 'noopener-allow-popups', true, true],
    ['same-origin-plus-COEP', 'same-origin-plus-COEP', true, true],
  ])('matches %s and %s with same origin %s', (active, response, sameOrigin, expected) => {
    expect(OpenerPolicy.matchValues(active, origin, response, sameOrigin ? origin : otherOrigin)).toBe(expected);
  });

  it('compares opaque origins by identity and ignores domain relaxation', () => {
    const opaque = createOpaqueOrigin();
    expect(OpenerPolicy.matchValues('same-origin', opaque, 'same-origin', opaque)).toBe(true);
    expect(OpenerPolicy.matchValues('same-origin', opaque, 'same-origin', createOpaqueOrigin())).toBe(false);
    const left = obtainURLOrigin(parseURL('https://a.example.com/').url!);
    const right = obtainURLOrigin(parseURL('https://b.example.com/').url!);
    if (left.kind !== 'tuple' || right.kind !== 'tuple') throw new Error('Expected tuple origins');
    left.domain = right.domain = { kind: 'domain', value: 'example.com' };
    expect(OpenerPolicy.matchValues('same-origin', left, 'same-origin', right)).toBe(false);
  });

  it.each<[OpenerPolicyValue, OpenerPolicyValue, boolean, boolean]>([
    ['same-origin-allow-popups', 'unsafe-none', true, false],
    ['noopener-allow-popups', 'unsafe-none', true, false],
    ['same-origin', 'unsafe-none', true, true],
    ['same-origin-allow-popups', 'unsafe-none', false, true],
    ['noopener-allow-popups', 'unsafe-none', false, true],
    ['noopener-allow-popups', 'noopener-allow-popups', true, true],
    ['noopener-allow-popups', 'noopener-allow-popups', false, false],
  ])('switches from %s to %s with initial about:blank %s', (active, response, initial, expected) => {
    expect(OpenerPolicy.requiresGroupSwitch(initial, origin, origin, response, active)).toBe(expected);
  });

  it('suppresses reports between matching report-only policies', () => {
    expect(OpenerPolicy.reportOnlyRequiresGroupSwitch(false, origin, origin,
      makePolicy('unsafe-none', 'same-origin'), makePolicy('unsafe-none', 'same-origin'))).toBe(false);
  });

  it('checks both enforced/report-only pairings', () => {
    expect(OpenerPolicy.reportOnlyRequiresGroupSwitch(false, origin, origin,
      makePolicy('unsafe-none', 'same-origin'), makePolicy('unsafe-none'))).toBe(true);
    expect(OpenerPolicy.reportOnlyRequiresGroupSwitch(false, origin, origin,
      makePolicy('unsafe-none'), makePolicy('unsafe-none', 'same-origin'))).toBe(true);
    expect(OpenerPolicy.reportOnlyRequiresGroupSwitch(false, origin, origin,
      makePolicy('same-origin', 'unsafe-none'), makePolicy('unsafe-none', 'same-origin'))).toBe(false);
  });
});

describe('cross-origin opener policy report URLs', () => {
  it.each([
    ['https://user:password@example.com/path?query#fragment', 'https://example.com/path?query'],
    ['http://example.com:8080/path#', 'http://example.com:8080/path'],
    ['data:text/plain,content#fragment', 'data:text/plain,content'],
  ])('sanitizes %s without mutating its source', (input, expected) => {
    const url = parseURL(input).url!;
    const original = serializeURL(url);
    expect(sanitizeURLForReport(url)).toBe(expected);
    expect(serializeURL(url)).toBe(original);
  });
});

describe('cross-origin opener policy navigation', () => {
  it('applies a secure response policy and switches its browsing context group', () => {
    const browser = new Browlet({ route: () => '' });
    const initial = unwrap<DocumentImpl>(browser.document);
    const navigable = initial.getNodeNavigable()!;
    const response = new FetchResponse();
    response.urlList.push(parseURL('https://example.com/').url!);
    response.headerList.append('Cross-Origin-Opener-Policy', 'same-origin');
    const params = navigable.createNavigationParams(response);
    const document = navigable.createAndInitializeDocument('html', 'text/html', params);

    expect(document.openerPolicy.value).toBe('same-origin');
    expect(document.browsingContext!.group).not.toBe(initial.browsingContext!.group);
  });

  it('retains a group for matching policies and switches when leaving the policy', () => {
    const browser = new Browlet({ route: () => '' });
    const first = navigate(browser, { 'Cross-Origin-Opener-Policy': 'same-origin' });
    const firstProxy = browser.window;
    const second = navigate(browser, { 'Cross-Origin-Opener-Policy': 'same-origin' });
    expect(second.browsingContext).toBe(first.browsingContext);
    expect(browser.window).toBe(firstProxy);
    const third = navigate(browser, {});
    expect(third.browsingContext!.group).not.toBe(first.browsingContext!.group);
    expect(browser.window).not.toBe(firstProxy);
    expect(first.browsingContext!.group!.browsingContextSet.has(first.browsingContext!)).toBe(true);
  });

  it('isolates same-site but cross-origin COOP documents', () => {
    const browser = new Browlet({ route: () => '' });
    const first = navigate(browser, { 'Cross-Origin-Opener-Policy': 'same-origin' }, 'https://a.example.com/');
    const second = navigate(browser, { 'Cross-Origin-Opener-Policy': 'same-origin' }, 'https://b.example.com/');
    expect(second.browsingContext!.group).not.toBe(first.browsingContext!.group);
  });

  it.each([['http://example.com/', undefined], ['https://example.com/', false]] as const)('honors the security decision at %s (%s)', (url, secure) => {
    const browser = new Browlet({ route: () => '' });
    const context = unwrap<DocumentImpl>(browser.document).browsingContext;
    const document = navigate(browser, { 'Cross-Origin-Opener-Policy': 'same-origin' }, url, secure);
    expect(document.openerPolicy.value).toBe('unsafe-none');
    expect(document.browsingContext).toBe(context);
  });

  it.each(['require-corp', 'credentialless'])('origin-keys logical isolation with %s without granting isolated capability', (coep) => {
    const browser = new Browlet({ route: () => '' });
    const document = navigate(browser, {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': coep,
    });
    expect(document.openerPolicy.value).toBe('same-origin-plus-COEP');
    expect(document.policyContainer.embedderPolicy.value).toBe(coep);
    expect(document.browsingContext!.group!.crossOriginIsolationMode).toBe('logical');
    expect(browser.window.originAgentCluster).toBe(true);
    expect(browser.window.crossOriginIsolated).toBe(false);
  });

  it('changes only the virtual group for report-only switches', () => {
    const browser = new Browlet({ route: () => '' });
    const context = unwrap<DocumentImpl>(browser.document).browsingContext!;
    const group = context.group;
    const originalID = context.virtualBrowsingContextGroupID;
    navigate(browser, { 'Cross-Origin-Opener-Policy-Report-Only': 'same-origin' });
    const firstID = context.virtualBrowsingContextGroupID;
    expect(firstID).not.toBe(originalID);
    navigate(browser, { 'Cross-Origin-Opener-Policy-Report-Only': 'same-origin' });
    expect(context.virtualBrowsingContextGroupID).toBe(firstID);
    const document = navigate(browser, {});
    expect(context.virtualBrowsingContextGroupID).not.toBe(firstID);
    expect(document.browsingContext).toBe(context);
    expect(context.group).toBe(group);
  });

  it('clones sandbox restrictions when switching away from an isolated policy', () => {
    const browser = new Browlet({ route: () => '' });
    const initial = navigate(browser, { 'Cross-Origin-Opener-Policy': 'same-origin' });
    const navigable = initial.getNodeNavigable()!;
    const params = navigable.createNavigationParams(makeResponse({ 'Content-Security-Policy': 'sandbox allow-same-origin' }));
    const document = navigable.createAndInitializeDocument('html', 'text/html', params);
    const context = document.browsingContext!;
    expect(context.group).not.toBe(initial.browsingContext!.group);
    expect(context.popupSandboxingFlagSet).toEqual(params.finalSandboxingFlagSet);
    expect(context.popupSandboxingFlagSet).not.toBe(params.finalSandboxingFlagSet);
    expect(params.reservedEnv!.targetBrowsingContext).toBe(context);
    expect(document.env.targetBrowsingContext).toBe(context);
  });
});

describe('cross-origin opener policy response enforcement', () => {
  it('retains switches through later matching redirects and records the initial URL once', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const context = document.browsingContext!;
    const firstURL = parseURL('https://example.com/first').url!;
    const secondURL = parseURL('https://example.com/second').url!;
    const policy = makePolicy('same-origin', 'same-origin');
    const initial = enforcementSnapshot(document);
    const first = context.enforceResponseOpenerPolicy(firstURL, obtainURLOrigin(firstURL), policy, initial, null);
    const second = context.enforceResponseOpenerPolicy(secondURL, obtainURLOrigin(secondURL), policy, first, null);
    expect(second).toMatchObject({
      needsBrowsingContextGroupSwitch: true,
      wouldNeedBrowsingContextGroupSwitchDueToReportOnly: true,
      url: secondURL,
      openerPolicy: policy,
      currentContextIsNavigationSource: true,
    });
    expect(initial.needsBrowsingContextGroupSwitch).toBe(false);
    expect(context.initialURL).toBe(firstURL);
  });

  it('requests reports for both dispositions only when another context shares the group', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const context = document.browsingContext!;
    const response = makeResponse();
    const policy = makePolicy('same-origin', 'same-origin');
    const to = vi.spyOn(policy, 'queueNavigationToReport').mockImplementation(() => {});
    const from = vi.spyOn(document.openerPolicy, 'queueNavigationFromReport').mockImplementation(() => {});
    const snapshot = enforcementSnapshot(document);
    context.enforceResponseOpenerPolicy(response.url!, obtainURLOrigin(response.url!), policy, snapshot, null);
    expect(to).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    context.group!.append(new BrowsingContext());
    context.enforceResponseOpenerPolicy(response.url!, obtainURLOrigin(response.url!), policy, snapshot, null);
    expect(to.mock.calls.map(([disposition]) => disposition)).toEqual(['enforce', 'reporting']);
    expect(from.mock.calls.map(([disposition]) => disposition)).toEqual(['enforce', 'reporting']);
    expect(from.mock.calls[0]![5]).toBe(false);
  });
});

function makeResponse(headers: Record<string, string> = {}, url = 'https://example.com/'): FetchResponse {
  const response = new FetchResponse();
  response.urlList.push(parseURL(url).url!);
  for (const [name, value] of Object.entries(headers)) response.headerList.append(name, value);
  return response;
}

function makePolicy(value: OpenerPolicyValue, reportOnlyValue: OpenerPolicyValue = 'unsafe-none'): OpenerPolicy {
  const policy = new OpenerPolicy();
  policy.value = value;
  policy.reportOnlyValue = reportOnlyValue;
  return policy;
}

function reserve(browser: Browlet, response: FetchResponse, secure = true): BrowletEnvironmentBase {
  const document = unwrap<DocumentImpl>(browser.document);
  return new BrowletEnvironmentBase({
    userAgent: document.env.userAgent, creationURL: response.url!,
    topLevelCreationURL: response.url!, topLevelOrigin: obtainURLOrigin(response.url!),
    targetBrowsingContext: document.browsingContext, isSecureContext: secure,
  });
}

function enforcementSnapshot(document: DocumentImpl): OpenerPolicyEnforcementResult {
  return {
    needsBrowsingContextGroupSwitch: false,
    wouldNeedBrowsingContextGroupSwitchDueToReportOnly: false,
    url: document.url, origin: document.origin, openerPolicy: document.openerPolicy,
    currentContextIsNavigationSource: false,
  };
}

function navigate(browser: Browlet, headers: Record<string, string>, url?: string, secure?: boolean): DocumentImpl {
  const navigable = unwrap<DocumentImpl>(browser.document).getNodeNavigable()!;
  const response = makeResponse(headers, url);
  const params = navigable.createNavigationParams(response);
  if (secure !== undefined) params.reservedEnv = reserve(browser, response, secure);
  const document = navigable.createAndInitializeDocument('html', 'text/html', params);
  const entry = navigable.createHistoryEntry(document, params);
  navigable.finalizeCrossDocumentNavigation('push', 'browser UI', entry);
  return document;
}
