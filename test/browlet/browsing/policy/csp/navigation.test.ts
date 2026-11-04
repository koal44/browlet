import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { ContentSecurityPolicy } from '../../../../../src/browlet/browsing/policy/csp/policy';
import { parseURL, serializeURL } from '../../../../../src/url/index';
import { createCSPWindow } from './fixture';

describe('CSP navigation requests', () => {
  it.each([
    ['', false],
    ["default-src 'none'", true],
    ["default-src 'none'; script-src 'unsafe-inline'", false],
    ["script-src 'none'; script-src-elem 'unsafe-inline'", false],
    ["script-src 'unsafe-inline'; script-src-elem", true],
    ["script-src-attr 'none'", false],
    ["style-src 'none'", false],
    ["script-src 'self' * https:", true],
    ["script-src 'unsafe-eval'", true],
    ["script-src 'UNSAFE-INLINE'", false],
    ["script-src 'unsafe-inline' 'nonce-test'", true],
    ["script-src 'unsafe-inline' 'sha256-a'", true],
    ["script-src 'unsafe-inline' 'strict-dynamic'", true],
  ])('applies navigation inline checks for %s (blocked: %s)', (policy, blocked) => {
    const { request, env, document, runTask } = createCSPWindow(policy);
    request.urlList = [parseURL('javascript:void(0)').url!];
    expect(document.policyContainer.cspList!.isNavigationRequestBlocked(request, 'other', env)).toBe(blocked);
    expect(runTask()).toBe(blocked);
    expect(runTask()).toBe(false);
  });

  it.each(['sha256', 'sha384', 'sha512'])('hashes the complete encoded URL with %s only when unsafe-hashes allows it', (algorithm) => {
    const url = 'javascript:void("%E2%98%83%20snow")';
    const digest = (source: string) => `'${algorithm}-${createHash(algorithm).update(source).digest('base64')}'`;
    const { request, env, document, runTask } = createCSPWindow();
    request.urlList = [parseURL(url).url!];
    const list = document.policyContainer.cspList!;
    for (const [source, unsafeHashes, blocked] of [
      [url, true, false], [url, false, true], [decodeURIComponent(url), true, true], [url.slice(11), true, true],
    ] as const) {
      list.policies = [ContentSecurityPolicy.parse(
        `script-src ${unsafeHashes ? "'unsafe-hashes'" : ''} ${digest(source)}`, 'header', 'enforce',
      )];
      expect(list.isNavigationRequestBlocked(request, 'other', env)).toBe(blocked);
      expect(runTask()).toBe(blocked);
    }
  });

  it('reports all rejecting inline policies, including report-only and fallback policies', () => {
    const { request, env, document, window, runTask } = createCSPWindow("default-src 'none'");
    request.urlList = [parseURL('javascript:void(0)').url!];
    const list = document.policyContainer.cspList!;
    list.policies.push(
      ContentSecurityPolicy.parse("script-src 'none'", 'header', 'report'),
      ContentSecurityPolicy.parse("script-src-elem 'none'", 'header', 'enforce'),
    );
    const events: SecurityPolicyViolationEvent[] = [];
    window.document.addEventListener('securitypolicyviolation', (event) => events.push(event));
    expect(list.isNavigationRequestBlocked(request, 'other', env)).toBe(true);
    expect(events).toHaveLength(0);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(false);
    expect(events.map((event) => [event.effectiveDirective, event.blockedURI, event.disposition, event.isTrusted]))
      .toEqual([
        ['script-src-elem', 'inline', 'enforce', true],
        ['script-src-elem', 'inline', 'report', true],
        ['script-src-elem', 'inline', 'enforce', true],
      ]);
  });

  it('reports a monitored inline failure without blocking', () => {
    const { request, env, document, runTask } = createCSPWindow("script-src 'none'", 'report');
    request.urlList = [parseURL('javascript:void(0)').url!];
    expect(document.policyContainer.cspList!.isNavigationRequestBlocked(request, 'other', env)).toBe(false);
    expect(runTask()).toBe(true);
  });

  it('takes a 40-unit sample only when the selected inline directive requests it', () => {
    const { request, env, document, window, runTask } = createCSPWindow("script-src 'none' 'report-sample'");
    const source = `javascript:void("${'%20'.repeat(30)}")`;
    request.urlList = [parseURL(source).url!];
    const list = document.policyContainer.cspList!;
    list.policies.push(ContentSecurityPolicy.parse(
      "script-src-elem 'none'; script-src 'none' 'report-sample'", 'header', 'report',
    ));
    const samples: string[] = [];
    window.document.addEventListener('securitypolicyviolation', (event) => samples.push(event.sample));
    expect(list.isNavigationRequestBlocked(request, 'other', env)).toBe(true);
    expect(runTask()).toBe(true);
    expect(runTask()).toBe(true);
    expect(samples).toEqual([source.slice(0, 40), '']);
  });

  it('does not apply inline script policy to a network navigation', () => {
    const { request, env, document, runTask } = createCSPWindow("default-src 'none'");
    expect(document.policyContainer.cspList!.isNavigationRequestBlocked(request, 'other', env)).toBe(false);
    expect(runTask()).toBe(false);
  });

  it('uses form-action only for submissions, without default-src fallback', () => {
    const { request, env, document, runTask } = createCSPWindow("form-action 'self'; default-src 'none'");
    const list = document.policyContainer.cspList!;
    expect(list.isNavigationRequestBlocked(request, 'other', env)).toBe(false);
    expect(list.isNavigationRequestBlocked(request, 'form-submission', env)).toBe(true);
    expect(runTask()).toBe(true);
    request.urlList = [parseURL('https://protected.test/submit').url!];
    expect(list.isNavigationRequestBlocked(request, 'form-submission', env)).toBe(false);
    list.policies = [ContentSecurityPolicy.parse("default-src 'none'", 'header', 'enforce')];
    expect(list.isNavigationRequestBlocked(request, 'form-submission', env)).toBe(false);
    expect(runTask()).toBe(false);
  });

  it('matches the current form URL with redirect count, but reports the original URL', () => {
    const { request, env, document, window, runTask } = createCSPWindow('form-action https://allowed.test/only');
    const list = document.policyContainer.cspList!;
    request.urlList.push(parseURL('https://allowed.test/different').url!);
    request.redirectCount = 1;
    expect(list.isNavigationRequestBlocked(request, 'form-submission', env)).toBe(false);
    request.urlList.push(parseURL('https://rejected.test/only').url!);
    const events: SecurityPolicyViolationEvent[] = [];
    window.document.addEventListener('securitypolicyviolation', (event) => events.push(event));
    expect(list.isNavigationRequestBlocked(request, 'form-submission', env)).toBe(true);
    expect(runTask()).toBe(true);
    expect(events[0]!.effectiveDirective).toBe('form-action');
    expect(events[0]!.blockedURI).toBe('https://resource.test/file');
    expect(serializeURL(request.currentURL)).toBe('https://rejected.test/only');
  });

  it.each(['enforce', 'report'] as const)('finishes pre-navigation reporting before deciding whether to check inline source (%s)', (disposition) => {
    const { request, env, document, window, runTask } = createCSPWindow("form-action 'none'; script-src 'none'", disposition);
    request.urlList = [parseURL('javascript:void(0)').url!];
    const list = document.policyContainer.cspList!;
    list.policies.push(ContentSecurityPolicy.parse("form-action 'none'", 'header', 'report'));
    const directives: string[] = [];
    window.document.addEventListener('securitypolicyviolation', (event) => directives.push(event.effectiveDirective));
    expect(list.isNavigationRequestBlocked(request, 'form-submission', env)).toBe(disposition === 'enforce');
    while (runTask()) { /* Deliver each queued violation. */ }
    expect(directives).toEqual(disposition === 'enforce'
      ? ['form-action', 'form-action'] : ['form-action', 'form-action', 'script-src-elem']);
  });
});
