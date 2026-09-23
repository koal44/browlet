import { describe, expect, it } from 'vitest';
import { getRelevantRealm } from '../../../src/browlet/bindings';
import { Browlet } from '../../../src/browlet/browlet';
import { ReportingEndpoint } from '../../../src/browlet/reporting/endpoint';
import { createFetchWindow } from '../fetch-fixture';
import { UserAgent } from '../../../src/browlet/user-agent';
import { FetchResponse } from '../../../src/fetch/response';
import { obtainURLOrigin, parseURL, serializeURL } from '../../../src/url/url';

describe('Reporting endpoint configuration', () => {
  it('reads named endpoints and initializes their failure counts', () => {
    const response = createResponse('primary="https://collector.test/reports", secondary="/other"');
    const endpoints = ReportingEndpoint.parse(response, createGlobalScope().env);
    expect(endpoints.map(({ name, url, failures }) => [name, serializeURL(url), failures])).toEqual([
      ['primary', 'https://collector.test/reports', 0],
      ['secondary', 'https://example.test/other', 0],
    ]);
  });

  it('resolves relative references against the final response URL without changing it', () => {
    const response = createResponse('path="reports", root="/reports", other="//collector.test/reports", empty=""');
    response.urlList.unshift(parseURL('https://initial.test/redirect').url!);
    const endpoints = ReportingEndpoint.parse(response, createGlobalScope().env);
    expect(endpoints.map(({ url }) => serializeURL(url))).toEqual([
      'https://example.test/path/reports', 'https://example.test/reports',
      'https://collector.test/reports', 'https://example.test/path/document?query',
    ]);
    expect(serializeURL(response.url!)).toBe('https://example.test/path/document?query#fragment');
  });

  it('combines header lines and preserves distinct names with the last duplicate value', () => {
    const response = createResponse('first="/old", second="/second"');
    response.headerList.append('reporting-endpoints', 'first="/new", third="/third"');
    expect(ReportingEndpoint.parse(response, createGlobalScope().env).map(({ name, url }) => [name, serializeURL(url)]))
      .toEqual([
        ['first', 'https://example.test/new'], ['second', 'https://example.test/second'],
        ['third', 'https://example.test/third'],
      ]);
  });

  it('ignores valid structured-field parameters', () => {
    const response = createResponse('reports="/reports";priority=10;flag;future="value"');
    expect(ReportingEndpoint.parse(response, createGlobalScope().env).map(({ name }) => name)).toEqual(['reports']);
  });

  it.each([undefined, '', 'reports="/reports",', 'reports="unterminated', 'Reports="/reports"'])(
    'returns no endpoints for an absent, empty, or malformed dictionary: %s', (header) => {
      expect(ReportingEndpoint.parse(createResponse(header), createGlobalScope().env)).toEqual([]);
    },
  );

  it.each(['token', '?1', '42', ':YWJj:', '("/reports")', '%"/reports"'])(
    'ignores non-string members while retaining valid siblings: %s', (value) => {
      const response = createResponse(`bad=${value}, good="/reports"`);
      expect(ReportingEndpoint.parse(response, createGlobalScope().env).map(({ name }) => name)).toEqual(['good']);
    },
  );

  it('ignores invalid URLs and untrustworthy endpoints without dropping valid siblings', () => {
    const response = createResponse([
      'broken="https://[invalid"', 'remote="http://collector.test/reports"',
      'data="data:,report"', 'blank="about:blank"', 'valid="https://collector.test/reports"',
    ].join(', '));
    expect(ReportingEndpoint.parse(response, createGlobalScope().env).map(({ name }) => name)).toEqual(['valid']);
  });

  it('rejects configuration from an untrustworthy response even for a trustworthy endpoint', () => {
    const response = createResponse('reports="https://collector.test/reports"', 'http://example.test/');
    expect(ReportingEndpoint.parse(response, createGlobalScope().env)).toEqual([]);
  });

  it.each(['http://localhost:8080/', 'http://127.0.0.1:8080/', 'http://[::1]:8080/'])(
    'honors potentially trustworthy loopback origins: %s', (url) => {
      const response = createResponse(`local="/reports", collector="${url}other"`, url);
      expect(ReportingEndpoint.parse(response, createGlobalScope().env)).toHaveLength(2);
    },
  );

  it('uses the configuring global\'s user agent for explicit origin trust', () => {
    const userAgent = new UserAgent();
    const origin = obtainURLOrigin(parseURL('http://development.test/').url!);
    if (origin.kind !== 'tuple') throw new Error('Expected a tuple origin');
    userAgent.trustworthyOrigins.push(origin);
    const response = createResponse('reports="/reports"', 'http://development.test/');
    expect(ReportingEndpoint.parse(response, createFetchWindow(userAgent).realm.env)).toHaveLength(1);
    expect(ReportingEndpoint.parse(response, createGlobalScope().env)).toEqual([]);
  });

  it('cannot configure endpoints from a response without a URL', () => {
    const response = createResponse('reports="https://collector.test/reports"');
    response.urlList = [];
    expect(ReportingEndpoint.parse(response, createGlobalScope().env)).toEqual([]);
  });
});

describe('Global Reporting state', () => {
  it('keeps endpoint and report lists separate for each global', () => {
    const first = createGlobalScope();
    const second = createGlobalScope();
    expect(first.reportingEndpoints).toEqual([]);
    expect(first.reports).toEqual([]);
    expect(first.reports).not.toBe(second.reports);
    const response = createResponse('reports="/reports"');
    first.initializeReportingEndpoints(response);
    second.initializeReportingEndpoints(response);
    first.reportingEndpoints[0]!.failures++;
    expect(second.reportingEndpoints[0]!.failures).toBe(0);
    expect(first.reportingEndpoints[0]!.url).not.toBe(second.reportingEndpoints[0]!.url);
  });

  it('replaces the configuration, including when a subsequent response has none', () => {
    const scope = createGlobalScope();
    scope.initializeReportingEndpoints(createResponse('old="/old"'));
    scope.initializeReportingEndpoints(createResponse('new="/new"'));
    expect(scope.reportingEndpoints.map(({ name }) => name)).toEqual(['new']);
    scope.initializeReportingEndpoints(createResponse());
    expect(scope.reportingEndpoints).toEqual([]);
  });
});

function createResponse(header?: string, url = 'https://example.test/path/document?query#fragment'): FetchResponse {
  const response = new FetchResponse();
  response.urlList.push(parseURL(url).url!);
  if (header !== undefined) response.headerList.append('Reporting-Endpoints', header);
  return response;
}

function createGlobalScope() {
  const browlet = new Browlet({ route: () => '' });
  return getRelevantRealm(browlet.window).windowImplementation.getWindowOrWorkerGlobalScopeMixin();
}
