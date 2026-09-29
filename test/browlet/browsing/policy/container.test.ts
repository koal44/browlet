import { describe, expect, it } from 'vitest';
import { PolicyContainer } from '../../../../src/browlet/browsing/policy/container';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { IntegrityPolicy } from '../../../../src/browlet/browsing/policy/integrity-policy';
import { CSPList } from '../../../../src/browlet/browsing/policy/csp/list';
import { ContentSecurityPolicy } from '../../../../src/browlet/browsing/policy/csp/policy';
import { FetchResponse } from '../../../../src/fetch/response';
import { createOpaqueOrigin } from '../../../../src/url/origin';

describe('Policy containers', () => {
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
