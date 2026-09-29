import { describe, expect, it, vi } from 'vitest';
import { NavigationParams } from '../../../../../src/browlet/browsing/navigation/params';
import { createAndInitializeDocument } from '../../../../../src/browlet/browsing/document-lifecycle';
import { ContentSecurityPolicy } from '../../../../../src/browlet/browsing/policy/csp/policy';
import { FetchResponse } from '../../../../../src/fetch/response';
import { createOpaqueOrigin } from '../../../../../src/url/origin';
import { obtainURLOrigin, parseURL } from '../../../../../src/url/url';
import { createCSPWindow } from './fixture';

describe('CSP document initialization', () => {
  it.each(['enforce', 'report'] as const)('delivers upgrade-insecure-requests with disposition %s', (disposition) => {
    const { document, env } = createCSPWindow('upgrade-insecure-requests', disposition);
    document.initializeCSP();
    expect(env.insecureRequestsPolicy.upgrade).toBe(disposition === 'enforce');
    expect(env.insecureRequestsPolicy.shouldUpgradeNavigation(document.url)).toBe(disposition === 'enforce');
  });

  it('preserves an inherited CSP self origin instead of substituting a sandboxed origin', () => {
    const { document } = createCSPWindow("base-uri 'self'");
    const list = document.policyContainer.cspList!;
    const selfOrigin = list.selfOrigin;
    document.origin = createOpaqueOrigin();
    document.initializeCSP();
    expect(document.policyContainer.cspList).toBe(list);
    expect(list.selfOrigin).toBe(selfOrigin);
    expect(list.selfOrigin).not.toBe(document.origin);
  });

  it('combines enforced sandbox restrictions without letting a later policy relax them', () => {
    const { document } = createCSPWindow('sandbox allow-scripts');
    const list = document.policyContainer.cspList!;
    list.policies.push(ContentSecurityPolicy.parse('sandbox allow-same-origin', 'header', 'enforce'));
    const flags = list.getSandboxingFlags();
    expect(flags.has('sandboxed-origin')).toBe(true);
    expect(flags.has('sandboxed-scripts')).toBe(true);
    expect(flags.has('sandboxed-automatic-features')).toBe(true);
  });

  it('ignores sandbox in report-only or meta policies', () => {
    const { document } = createCSPWindow('sandbox', 'report');
    document.policyContainer.cspList!.policies.push(ContentSecurityPolicy.parse('sandbox', 'meta', 'enforce'));
    expect(document.policyContainer.cspList!.getSandboxingFlags().size).toBe(0);
  });

  it('derives sandbox flags and origin from the final response before Window selection', () => {
    const { traversable } = createCSPWindow();
    const response = new FetchResponse();
    response.urlList.push(parseURL('https://initial.test/').url!, parseURL('https://protected.test/page').url!);
    response.headerList.append('Content-Security-Policy', "sandbox allow-scripts; default-src 'self'");
    const params = NavigationParams.fromResponse(traversable, response);
    expect(params.response).toBe(response);
    expect(params.origin.kind).toBe('opaque');
    expect(params.finalSandboxingFlagSet.has('sandboxed-origin')).toBe(true);
    expect(params.finalSandboxingFlagSet.has('sandboxed-scripts')).toBe(false);
    expect(params.policyContainer.cspList!.selfOrigin).toEqual(obtainURLOrigin(response.url!));
  });

  it('retains a tuple origin when the enforced sandbox permits same-origin', () => {
    const { traversable } = createCSPWindow();
    const response = new FetchResponse();
    response.urlList.push(parseURL('https://protected.test/page').url!);
    response.headerList.append('Content-Security-Policy', 'sandbox allow-same-origin');
    const params = NavigationParams.fromResponse(traversable, response);
    expect(params.origin).toEqual(obtainURLOrigin(response.url!));
    expect(params.finalSandboxingFlagSet.has('sandboxed-scripts')).toBe(true);
  });
});

describe('CSP delivery', () => {
  it('creates a Document from a Fetch response and delivers policies, status, and Reporting endpoints', () => {
    const { traversable } = createCSPWindow();
    const response = new FetchResponse();
    response.urlList.push(parseURL('https://next.test/page').url!);
    response.status = 203;
    response.headerList.append('Content-Security-Policy', 'upgrade-insecure-requests');
    response.headerList.append('Reporting-Endpoints', 'csp="/reports"');
    const params = NavigationParams.fromResponse(traversable, response);
    const document = createAndInitializeDocument('html', 'text/html', params);
    expect(document.httpStatus).toBe(203);
    expect(document.env.insecureRequestsPolicy.upgrade).toBe(true);
    expect(document.env.getWindowOrWorkerGlobalScopeMixin().reportingEndpoints).toHaveLength(1);
  });

  it('routes a parser warning to its environment without interrupting policy initialization', () => {
    const { document, env } = createCSPWindow("img-src 'none'; img-src https:; upgrade-insecure-requests");
    const reportWarning = vi.spyOn(env, 'reportConsoleWarning');
    document.initializeCSP();
    expect(env.insecureRequestsPolicy.upgrade).toBe(true);
    const warnings = document.policyContainer.cspList!.policies[0]!.parsingWarnings;
    expect(warnings).toHaveLength(1);
    expect(reportWarning).toHaveBeenCalledExactlyOnceWith(warnings[0]);
  });
});
