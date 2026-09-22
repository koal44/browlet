import { describe, expect, it, vi } from 'vitest';
import { PolicyContainer } from '../../src/browlet/browsing/policy/container';
import type { FetchEnvironmentSettingsObject } from '../../src/fetch/infrastructure';
import { FetchRequest, type Destination, type FetchMode } from '../../src/fetch/request';
import { FetchResponse } from '../../src/fetch/response';
import { parseURL, serializeURL } from '../../src/url/url';
import { createClientSettings } from './client-fixture';

describe('Integrity Policy request blocking', () => {
  it('allows requests under empty policies', () => {
    const { request, client } = createRequest();
    expect(request.isBlockedByIntegrityPolicy()).toBe(false);
    expect(client.queueReport).not.toHaveBeenCalled();
  });

  it.each<Destination>(['script', 'style'])('blocks a required %s without integrity metadata', (destination) => {
    const { request } = createRequest(`blocked-destinations=(${destination})`);
    request.destination = destination;
    expect(request.isBlockedByIntegrityPolicy()).toBe(true);
  });

  it('reports a report-only violation without blocking', () => {
    const { request, client } = createRequest('', scriptPolicy);
    expect(request.isBlockedByIntegrityPolicy()).toBe(false);
    expect(client.queueReport).toHaveBeenCalledExactlyOnceWith('integrity-violation', 'reports', {
      documentURL: 'https://document.test/page', blockedURL: 'https://resource.test/script.js',
      destination: 'script', reportOnly: true,
    });
  });

  it.each<FetchMode>(['cors', 'same-origin'])('allows recognized metadata with %s mode without reporting', (mode) => {
    const { request, client } = createRequest(scriptPolicy, scriptPolicy);
    request.mode = mode;
    request.integrityMetadata = 'sha384-YQ';
    expect(request.isBlockedByIntegrityPolicy()).toBe(false);
    expect(client.queueReport).not.toHaveBeenCalled();
  });

  it.each<FetchMode>(['no-cors', 'navigate', 'websocket', 'webtransport'])(
    'does not exempt %s mode merely because metadata is present', (mode) => {
      const { request } = createRequest(scriptPolicy);
      request.mode = mode;
      request.integrityMetadata = 'sha256-YQ==';
      expect(request.isBlockedByIntegrityPolicy()).toBe(true);
    },
  );

  it.each(['', ' \t\n', 'sha1-YQ==', 'sha256-?', 'not-a-hash'])(
    'does not exempt missing, unsupported, or malformed metadata %j', (metadata) => {
      const { request } = createRequest(scriptPolicy);
      request.integrityMetadata = metadata;
      expect(request.isBlockedByIntegrityPolicy()).toBe(true);
    },
  );

  it('leaves digest verification to the response byte check', () => {
    const { request } = createRequest(scriptPolicy);
    request.integrityMetadata = 'SHA512-A';
    expect(request.isBlockedByIntegrityPolicy()).toBe(false);
  });

  it.each(['about:blank', 'data:text/javascript,', 'blob:https://resource.test/id'])(
    'allows local URL %s even with no-cors mode and no metadata', (url) => {
      const { request, client } = createRequest(scriptPolicy, scriptPolicy, url);
      request.mode = 'no-cors';
      expect(request.isBlockedByIntegrityPolicy()).toBe(false);
      expect(client.queueReport).not.toHaveBeenCalled();
    },
  );

  it('does not treat file URLs as Fetch-local URLs', () => {
    const { request, client } = createRequest(scriptPolicy, '', 'file:///private/script.js');
    expect(request.isBlockedByIntegrityPolicy()).toBe(true);
    expect(client.queueReport.mock.calls[0]![2].blockedURL).toBe('file');
  });

  it.each<Destination>(['', 'image', 'worker', 'document', 'serviceworker', 'json'])(
    'does not restrict the unlisted %j destination', (destination) => {
      const { request, client } = createRequest(scriptPolicy, scriptPolicy);
      request.destination = destination;
      expect(request.isBlockedByIntegrityPolicy()).toBe(false);
      expect(client.queueReport).not.toHaveBeenCalled();
    },
  );

  it.each(['sources=()', 'sources=(future)', 'blocked-destinations=(style)'])(
    'does not match a policy without the required inline source and destination: %s', (field) => {
      const policy = `${scriptPolicy}, ${field}`;
      const { request, client } = createRequest(policy, policy);
      expect(request.isBlockedByIntegrityPolicy()).toBe(false);
      expect(client.queueReport).not.toHaveBeenCalled();
    },
  );

  it('allows a clientless request without inventing a report owner', () => {
    const { request, client } = createRequest(scriptPolicy, scriptPolicy);
    request.client = null;
    expect(request.isBlockedByIntegrityPolicy()).toBe(false);
    expect(client.queueReport).not.toHaveBeenCalled();
  });

  it('does not apply the policy to a global outside Window and Worker', () => {
    const { request, client } = createRequest(scriptPolicy, scriptPolicy);
    client.getReportingSource = () => null;
    expect(request.isBlockedByIntegrityPolicy()).toBe(false);
    expect(client.queueReport).not.toHaveBeenCalled();
  });

  it('uses the request policy snapshot rather than rereading the live client policies', () => {
    const { request, client } = createRequest(scriptPolicy);
    client.policyContainer.integrityPolicy.blockedDestinations.length = 0;
    expect(request.isBlockedByIntegrityPolicy()).toBe(true);
    expect(client.queueReport).toHaveBeenCalledOnce();
  });

  it('requires the request policy container to be resolved instead of falling back to the live client', () => {
    const { request, client } = createRequest(scriptPolicy);
    request.policyContainer = undefined;
    expect(() => request.isBlockedByIntegrityPolicy()).toThrow('Fetch request policy container has not been resolved');
    expect(client.queueReport).not.toHaveBeenCalled();
  });
});

describe('Integrity Policy violation reports', () => {
  it('reports enforcing endpoints before report-only endpoints with independent boolean bodies', () => {
    const { request, client } = createRequest(
      'blocked-destinations=(script style), endpoints=(first second)',
      'blocked-destinations=(script style), endpoints=(first)',
    );
    request.destination = 'style';
    expect(request.isBlockedByIntegrityPolicy()).toBe(true);
    const calls = client.queueReport.mock.calls;
    const body = {
      documentURL: 'https://document.test/page', blockedURL: 'https://resource.test/script.js', destination: 'style',
    };
    expect(calls).toEqual([
      ['integrity-violation', 'first', { ...body, reportOnly: false }],
      ['integrity-violation', 'second', { ...body, reportOnly: false }],
      ['integrity-violation', 'first', { ...body, reportOnly: true }],
    ]);
    expect(calls[0]![2]).not.toBe(calls[1]![2]);
    expect(calls[0]![2]).not.toBe(calls[2]![2]);
  });

  it('reports only policies matching the requested destination', () => {
    const { request, client } = createRequest(
      'blocked-destinations=(style), endpoints=(enforced)', scriptPolicy,
    );
    expect(request.isBlockedByIntegrityPolicy()).toBe(false);
    expect(client.queueReport).toHaveBeenCalledExactlyOnceWith('integrity-violation', 'reports', {
      documentURL: 'https://document.test/page', blockedURL: 'https://resource.test/script.js',
      destination: 'script', reportOnly: true,
    });
  });

  it('blocks independently of endpoints and follows the draft\'s per-endpoint reporting loop', () => {
    const { request, client } = createRequest('blocked-destinations=(script)', 'blocked-destinations=(script)');
    expect(request.isBlockedByIntegrityPolicy()).toBe(true);
    expect(client.queueReport).not.toHaveBeenCalled();
  });

  it('sanitizes the original request and document URLs without changing either source', () => {
    const original = 'https://user:password@resource.test/script.js?q=1#secret';
    const { request, client } = createRequest(scriptPolicy, '', original);
    const documentURL = parseURL('https://user:password@document.test/page?q=2#secret').url!;
    client.getReportingSource = () => documentURL;
    request.urlList.push(parseURL('https://redirect.test/target').url!);
    expect(request.isBlockedByIntegrityPolicy()).toBe(true);
    expect(client.queueReport).toHaveBeenCalledExactlyOnceWith('integrity-violation', 'reports', {
      documentURL: 'https://document.test/page?q=2', blockedURL: 'https://resource.test/script.js?q=1',
      destination: 'script', reportOnly: false,
    });
    expect(serializeURL(request.url)).toBe(original);
    expect(serializeURL(documentURL)).toBe('https://user:password@document.test/page?q=2#secret');
  });

  it('reduces a non-HTTP document URL to its scheme', () => {
    const { request, client } = createRequest(scriptPolicy);
    client.getReportingSource = () => parseURL('data:text/html,private').url!;
    expect(request.isBlockedByIntegrityPolicy()).toBe(true);
    expect(client.queueReport.mock.calls[0]![2].documentURL).toBe('data');
  });
});

const scriptPolicy = 'blocked-destinations=(script), endpoints=(reports)';

function createRequest(enforced = '', reportOnly = '', url = 'https://resource.test/script.js') {
  const container = new PolicyContainer();
  const response = new FetchResponse();
  if (enforced !== '') response.headerList.append('Integrity-Policy', enforced);
  if (reportOnly !== '') response.headerList.append('Integrity-Policy-Report-Only', reportOnly);
  container.parseIntegrityPolicyHeaders(response);
  const client = {
    ...createClientSettings('https://document.test/page#fragment'), policyContainer: container,
    queueReport: vi.fn<FetchEnvironmentSettingsObject['queueReport']>(),
  };
  const request = new FetchRequest(parseURL(url).url!, client, client.userAgent);
  request.mode = 'cors';
  request.destination = 'script';
  request.populateFromClient();
  return { request, client };
}
