import { describe, expect, it, vi } from 'vitest';
import type { FetchEmbedderPolicyValue } from '../../../src/fetch/environment';
import { FetchResponse } from '../../../src/fetch/response';
import { createOpaqueOrigin } from '../../../src/url/origin';
import { obtainURLOrigin, parseURL } from '../../../src/url/url';
import { createClientEnvironment } from '../client-fixture';

describe('CORP blocking and violation reporting', () => {
  it('allows an unrestricted response without reporting', () => {
    const response = createResponse();
    const env = createReportingEnvironment();
    expect(response.isBlockedByCORP(originFor('https://other.test/'), env, 'image')).toBe(false);
    expect(env.queueReport).not.toHaveBeenCalled();
  });

  it('does not report a restriction imposed by CORP itself', () => {
    const response = createResponse('https://example.test/', 'same-origin');
    const env = createReportingEnvironment('require-corp', 'require-corp');
    expect(response.isBlockedByCORP(originFor('https://other.test/'), env, 'image')).toBe(true);
    expect(env.queueReport).not.toHaveBeenCalled();
  });

  it('reports a report-only violation without blocking the response', () => {
    const response = createResponse();
    const env = createReportingEnvironment('unsafe-none', 'require-corp');
    expect(response.isBlockedByCORP(originFor('https://other.test/'), env, 'image')).toBe(false);
    expect(env.queueReport).toHaveBeenCalledExactlyOnceWith('coep', 'observe', {
      type: 'corp', blockedURL: 'https://example.test/resource', destination: 'image', disposition: 'reporting',
    });
  });

  it('reports and blocks an enforced violation', () => {
    const response = createResponse();
    const env = createReportingEnvironment('require-corp');
    expect(response.isBlockedByCORP(originFor('https://other.test/'), env, 'image')).toBe(true);
    expect(env.queueReport).toHaveBeenCalledExactlyOnceWith('coep', 'enforce', {
      type: 'corp', blockedURL: 'https://example.test/resource', destination: 'image', disposition: 'enforce',
    });
  });

  it('reports both violations in order using the sanitized first URL', () => {
    const response = createResponse('https://user:secret@example.test/original#fragment');
    response.urlList.push(parseURL('https://elsewhere.test/redirected').url!);
    const env = createReportingEnvironment('require-corp', 'require-corp');
    expect(response.isBlockedByCORP(originFor('https://example.test/'), env, 'image')).toBe(true);
    expect(env.queueReport.mock.calls).toEqual([
      ['coep', 'observe', {
        type: 'corp', blockedURL: 'https://example.test/original', destination: 'image', disposition: 'reporting',
      }],
      ['coep', 'enforce', {
        type: 'corp', blockedURL: 'https://example.test/original', destination: 'image', disposition: 'enforce',
      }],
    ]);
  });

  it('uses the navigation exception before checking a restrictive report-only policy', () => {
    const response = createResponse('https://example.test/', 'same-origin');
    const env = createReportingEnvironment('unsafe-none', 'require-corp');
    expect(response.isBlockedByCORP(originFor('https://other.test/'), env, 'iframe', true))
      .toBe(false);
    expect(env.queueReport).toHaveBeenCalledExactlyOnceWith('coep', 'observe', {
      type: 'corp', blockedURL: 'https://example.test/', destination: 'iframe', disposition: 'reporting',
    });
  });
});

describe('CORP internal policy check (Fetch §3.7)', () => {
  it('permits an unrestricted response and an explicit cross-origin policy', () => {
    const response = createResponse();
    const origin = originFor('https://other.test/');
    expect(response.isBlockedByCORPInternal(origin, 'unsafe-none', false)).toBe(false);
    response.headerList.set('Cross-Origin-Resource-Policy', 'cross-origin');
    for (const policy of embedderPolicies) {
      expect(response.isBlockedByCORPInternal(origin, policy, false)).toBe(false);
    }
  });

  it('compares scheme, host, and port for same-origin', () => {
    const response = createResponse('https://example.test/resource', 'same-origin');
    expect(response.isBlockedByCORPInternal(originFor('https://example.test:443/'), 'unsafe-none', false))
      .toBe(false);
    for (const url of ['http://example.test/', 'https://other.test/', 'https://example.test:444/']) {
      expect(response.isBlockedByCORPInternal(originFor(url), 'unsafe-none', false)).toBe(true);
    }
  });

  it.each<[string, string, boolean]>([
    ['https://a.example.com/', 'https://b.example.com:8443/', false],
    ['https://a.example.com/', 'http://b.example.com/', false],
    ['http://a.example.com/', 'http://b.example.com/', false],
    ['http://a.example.com/', 'https://b.example.com/', true],
    ['https://example.com/', 'https://other.com/', true],
    ['https://a.co.uk/', 'https://b.co.uk/', true],
    ['https://alice.github.io/', 'https://bob.github.io/', true],
    ['https://localhost/', 'https://localhost:8443/', false],
    ['https://127.0.0.1/', 'https://127.0.0.1:8443/', false],
    ['https://[::1]/', 'https://[::1]:8443/', false],
    ['https://127.0.0.1/', 'https://127.0.0.2/', true],
  ])('checks same-site from %s to %s', (source, target, expected) => {
    const response = createResponse(target, 'same-site');
    expect(response.isBlockedByCORPInternal(originFor(source), 'unsafe-none', false)).toBe(expected);
  });

  it('does not grant an opaque origin same-origin or same-site access', () => {
    const origin = createOpaqueOrigin();
    for (const policy of ['same-origin', 'same-site']) {
      const response = createResponse('https://example.test/', policy);
      expect(response.isBlockedByCORPInternal(origin, 'unsafe-none', false)).toBe(true);
    }
  });

  it.each<FetchEmbedderPolicyValue>(['require-corp', 'credentialless'])(
    'requires same-origin without CORP when %s applies to a credentialed response', (policy) => {
      const response = createResponse();
      expect(response.isBlockedByCORPInternal(originFor('https://example.test/'), policy, false))
        .toBe(false);
      expect(response.isBlockedByCORPInternal(originFor('https://other.test/'), policy, false))
        .toBe(true);
    },
  );

  it('relaxes credentialless only for responses requested without credentials', () => {
    const response = createResponse();
    response.requestIncludesCredentials = false;
    const origin = originFor('https://other.test/');
    expect(response.isBlockedByCORPInternal(origin, 'credentialless', false)).toBe(false);
    expect(response.isBlockedByCORPInternal(origin, 'require-corp', false)).toBe(true);
    response.headerList.set('Cross-Origin-Resource-Policy', 'same-origin');
    expect(response.isBlockedByCORPInternal(origin, 'credentialless', false)).toBe(true);
  });

  it('ignores CORP on ordinary navigation but enforces both restrictive embedder policies', () => {
    const response = createResponse('https://example.test/', 'same-origin');
    const origin = originFor('https://other.test/');
    expect(response.isBlockedByCORPInternal(origin, 'unsafe-none', true)).toBe(false);
    response.headerList.delete('Cross-Origin-Resource-Policy');
    response.requestIncludesCredentials = false;
    for (const policy of ['require-corp', 'credentialless'] satisfies FetchEmbedderPolicyValue[]) {
      expect(response.isBlockedByCORPInternal(origin, policy, true)).toBe(true);
      response.headerList.set('Cross-Origin-Resource-Policy', 'cross-origin');
      expect(response.isBlockedByCORPInternal(origin, policy, true)).toBe(false);
      response.headerList.delete('Cross-Origin-Resource-Policy');
    }
  });

  it.each(['', 'Same-Origin', 'SAME-SITE', '"same-origin"', 'same-origin, same-origin', 'cross-origin, same-site'])(
    'treats %j as absent without bypassing the embedder policy', (value) => {
      const response = createResponse('https://example.test/', value);
      const origin = originFor('https://other.test/');
      expect(response.isBlockedByCORPInternal(origin, 'unsafe-none', false)).toBe(false);
      expect(response.isBlockedByCORPInternal(origin, 'require-corp', false)).toBe(true);
    },
  );

  it('combines duplicate field lines before comparing the exact policy value', () => {
    const response = createResponse('https://example.test/', 'cross-origin');
    const origin = originFor('https://other.test/');
    response.headerList.append('cross-origin-resource-policy', 'cross-origin');
    expect(response.isBlockedByCORPInternal(origin, 'require-corp', false)).toBe(true);
    expect(response.isBlockedByCORPInternal(origin, 'unsafe-none', false)).toBe(false);
  });

  it('compares the final response URL rather than the first URL used for reporting', () => {
    const response = createResponse('https://example.test/', 'same-origin');
    response.urlList.push(parseURL('https://other.test/redirected').url!);
    expect(response.isBlockedByCORPInternal(originFor('https://example.test/'), 'unsafe-none', false))
      .toBe(true);
    expect(response.isBlockedByCORPInternal(originFor('https://other.test/'), 'unsafe-none', false))
      .toBe(false);
  });
});

const embedderPolicies: FetchEmbedderPolicyValue[] = ['unsafe-none', 'require-corp', 'credentialless'];

function createResponse(url = 'https://example.test/resource', policy?: string): FetchResponse {
  const response = new FetchResponse();
  response.urlList.push(parseURL(url).url!);
  if (policy !== undefined) response.headerList.set('Cross-Origin-Resource-Policy', policy);
  return response;
}

function originFor(url: string) {
  return obtainURLOrigin(parseURL(url).url!);
}

// Observe the Reporting capability without implementing report generation or delivery.
function createReportingEnvironment(
  value: FetchEmbedderPolicyValue = 'unsafe-none', reportOnlyValue: FetchEmbedderPolicyValue = 'unsafe-none',
) {
  const env = createClientEnvironment();
  return Object.assign(env, {
    policyContainer: {
      ...env.policyContainer,
      embedderPolicy: { value, reportOnlyValue, reportingEndpoint: 'enforce', reportOnlyReportingEndpoint: 'observe' },
    },
    queueReport: vi.fn(),
  });
}
