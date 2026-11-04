import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserAgent } from '../../../../../src/browlet/user-agent';
import { ContentSecurityPolicy } from '../../../../../src/browlet/browsing/policy/csp/policy';
import { CSPViolation, CSPViolationReportBodyImpl } from '../../../../../src/browlet/browsing/policy/csp/violation';
import { ReportingEndpoint } from '../../../../../src/browlet/reporting/endpoint';
import * as fetchModule from '../../../../../src/fetch/index';
import { FetchController, FetchResponse } from '../../../../../src/fetch/index';
import { parseURL, serializeOrigin, serializeURL } from '../../../../../src/url/index';
import { closeServer, listen } from '../../../loader/http-fixture';
import { createCSPWindow } from './fixture';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

describe('CSP navigation-response violation construction', () => {
  it('captures the final response URL and status without an incoming global', () => {
    const userAgent = new UserAgent();
    const policy = ContentSecurityPolicy.parse("frame-ancestors 'none'", 'header', 'report');
    const response = createResponse();
    response.urlList.unshift(parseURL('https://redirect.test/initial').url!);
    const violation = CSPViolation.fromNavigationResponse(policy, 'frame-ancestors', response, userAgent);
    response.url!.path = ['changed'];
    response.status = 500;

    expect(violation.env).toBeNull();
    expect(violation.referrer).toBeNull();
    expect(violation.element).toBeNull();
    expect(violation.status).toBe(201);
    expect(new CSPViolationReportBodyImpl(violation)).toMatchObject({
      documentURL: 'https://incoming.test/path/page?query',
      blockedURL: 'https://incoming.test/path/page?query',
      referrer: null, statusCode: 201, disposition: 'report',
      effectiveDirective: 'frame-ancestors', sourceFile: null, lineNumber: null, columnNumber: null,
    });
    expect(JSON.parse(new TextDecoder().decode(violation.serialize()))).toMatchObject({
      'csp-report': {
        'document-uri': 'https://incoming.test/path/page?query',
        'blocked-uri': 'https://incoming.test/path/page?query',
        referrer: '', 'status-code': 201, disposition: 'report', 'script-sample': '',
      },
    });
  });

  it('requires the response URL instead of substituting an existing Document URL', () => {
    const policy = ContentSecurityPolicy.parse("frame-ancestors 'none'", 'header', 'enforce');
    expect(() => CSPViolation.fromNavigationResponse(policy, 'frame-ancestors', new FetchResponse(), new UserAgent()))
      .toThrow('CSP navigation violations require a response URL');
  });
});

describe('CSP navigation-response report delivery', () => {
  it('queues clientless legacy requests with opaque origins and no credentials', () => {
    const { userAgent, response, tasks, fetch } = fixture();
    const policy = ContentSecurityPolicy.parse(
      "frame-ancestors 'none'; report-uri reports http://[bad https://collector.test/report", 'header', 'enforce',
    );
    CSPViolation.fromNavigationResponse(policy, 'frame-ancestors', response, userAgent).report();
    expect(fetch).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(1);
    tasks.shift()!();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([request]) => serializeURL(request.url))).toEqual([
      'https://user:secret@incoming.test/path/reports', 'https://collector.test/report',
    ]);
    for (const [request, callbacks, env] of fetch.mock.calls) {
      expect(request.client).toBeNull();
      expect(serializeOrigin(request.origin!)).toBe('null');
      expect(request.credentialsMode).toBe('same-origin');
      expect(request.env).toBe(userAgent.sandbox);
      expect(env).toBe(userAgent.sandbox);
      expect(userAgent.sandbox.realm.getAssociatedDocument()).toBeNull();
      expect(request).toMatchObject({
        method: 'POST', destination: 'report', mode: 'no-cors', keepalive: true,
        redirectMode: 'error', traversableForUserPrompts: null, allowServiceWorkerInterception: false,
      });
      expect(request.headerList.get('Content-Type')).toBe('application/csp-report');
      expect(callbacks!.useParallelQueue).toBe(true);
    }
  });

  it('uses the captured incoming Reporting-Endpoints and the shared Reporting request contract', () => {
    const { userAgent, response, tasks, fetch } = fixture();
    const policy = ContentSecurityPolicy.parse("frame-ancestors 'none'; report-uri /legacy; report-to incoming", 'header', 'enforce');
    response.headerList.append('Reporting-Endpoints', 'incoming="https://collector.test/report"');
    const violation = CSPViolation.fromNavigationResponse(policy, 'frame-ancestors', response, userAgent);
    response.headerList.set('Reporting-Endpoints', 'incoming="https://wrong.test/report"');
    response.url!.path = ['changed'];
    violation.report();
    while (tasks.length) tasks.shift()!();

    expect(fetch).toHaveBeenCalledOnce();
    const request = fetch.mock.calls[0]![0];
    expect(request.client).toBeNull();
    expect(serializeOrigin(request.origin!)).toBe('https://incoming.test');
    expect(serializeURL(request.url)).toBe('https://collector.test/report');
    expect(request.mode).toBe('cors');
    expect(request.headerList.get('Content-Type')).toBe('application/reports+json');
    expect(JSON.parse(new TextDecoder().decode(request.body as Uint8Array))).toEqual([{
      age: expect.any(Number) as number, type: 'csp-violation', url: 'https://incoming.test/path/page?query',
      user_agent: userAgent.defaultUserAgentValue,
      body: {
        documentURL: 'https://incoming.test/path/page?query', blockedURL: 'https://incoming.test/path/page?query',
        referrer: null, statusCode: 201, effectiveDirective: 'frame-ancestors',
        originalPolicy: policy.serialized, disposition: 'enforce', sample: '',
        sourceFile: null, lineNumber: null, columnNumber: null,
      },
    }]);
  });

  it.each(['report-to missing', 'report-to', 'report-to missing; report-uri /legacy'])(
    'does not fall back to legacy delivery when the endpoint is unavailable: %s', (directives) => {
      const { userAgent, response, tasks, fetch } = fixture();
      const policy = ContentSecurityPolicy.parse(`frame-ancestors 'none'; ${directives}`, 'header', 'enforce');
      CSPViolation.fromNavigationResponse(policy, 'frame-ancestors', response, userAgent).report();
      while (tasks.length) tasks.shift()!();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['report-uri /legacy', 'report-to incoming'])(
    'honors delivery opt-out before the queued task runs: %s', (directives) => {
      const { userAgent, response, tasks, fetch } = fixture();
      response.headerList.append('Reporting-Endpoints', 'incoming="/report"');
      const policy = ContentSecurityPolicy.parse(`frame-ancestors 'none'; ${directives}`, 'header', 'enforce');
      CSPViolation.fromNavigationResponse(policy, 'frame-ancestors', response, userAgent).report();
      userAgent.reportDeliveryEnabled = false;
      while (tasks.length) tasks.shift()!();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('does not use an existing Window event target, observer queue, or endpoint configuration', () => {
    const { env, window, scope } = createCSPWindow();
    const userAgent = env.userAgent;
    const tasks: (() => void)[] = [];
    vi.spyOn(userAgent, 'queueReportingTask').mockImplementation((steps) => { tasks.push(steps); });
    const fetch = vi.spyOn(fetchModule, 'fetch').mockImplementation(() => new FetchController());
    const queueTask = vi.spyOn(env, 'queueTask');
    const event = vi.fn();
    window.document.addEventListener('securitypolicyviolation', event);
    scope.reportingEndpoints.push(new ReportingEndpoint('incoming', parseURL('https://old.test/report').url!));
    const policy = ContentSecurityPolicy.parse("frame-ancestors 'none'; report-to incoming", 'header', 'enforce');
    const response = createResponse();
    response.headerList.append('Reporting-Endpoints', 'incoming="https://new.test/report"');
    CSPViolation.fromNavigationResponse(policy, 'frame-ancestors', response, userAgent).report();
    while (tasks.length) tasks.shift()!();

    expect(queueTask).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
    expect(scope.reports).toEqual([]);
    expect(scope.reportBuffer).toEqual([]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(serializeURL(fetch.mock.calls[0]![0].url)).toBe('https://new.test/report');
  });
});

describe('CSP navigation-response reports through Fetch', () => {
  it.each(['report-uri', 'report-to'] as const)('delivers %s without any Window and releases the unused response body', async (directive) => {
    let closed = false;
    const received = Promise.withResolvers<{ cookie: string | undefined; origin: string | undefined; referrer: string | undefined; body: string; }>();
    const server = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => { body += chunk; });
      request.on('end', () => {
        received.resolve({ cookie: request.headers.cookie, origin: request.headers.origin, referrer: request.headers.referer, body });
        response.on('close', () => { closed = true; });
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.write('unused report response');
      });
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const userAgent = new UserAgent();
    cleanup.push(() => userAgent.httpTransport.close());
    const url = parseURL(`${origin}/incoming`).url!;
    const host = url.host;
    if (host === null || host.kind === 'opaque' || host.kind === 'empty') throw new Error('Expected an HTTP host');
    expect(userAgent.cookieStore.parseAndStoreCookie('session=secret; Path=/', false, host, [''], true, false, true)).not.toBeNull();
    const response = createResponse(`${origin}/incoming#private`);
    response.headerList.append('Reporting-Endpoints', 'incoming="/report"');
    const policy = ContentSecurityPolicy.parse(
      `frame-ancestors 'none'; ${directive} ${directive === 'report-uri' ? '/report' : 'incoming'}`, 'header', 'enforce',
    );
    CSPViolation.fromNavigationResponse(policy, 'frame-ancestors', response, userAgent).report();
    const report = await received.promise;

    expect(report.referrer).toBeUndefined();
    if (directive === 'report-uri') {
      expect(report.origin).toBe('null');
      expect(report.cookie).toBeUndefined();
      expect(JSON.parse(report.body)).toMatchObject({
        'csp-report': { 'document-uri': `${origin}/incoming`, 'blocked-uri': `${origin}/incoming`, 'status-code': 201, referrer: '' },
      });
    } else {
      expect(report.origin).toBe(origin);
      expect(JSON.parse(report.body)).toMatchObject([{
        type: 'csp-violation', url: `${origin}/incoming`, body: { documentURL: `${origin}/incoming`, statusCode: 201, referrer: null },
      }]);
    }
    await expect.poll(() => closed).toBe(true);
  });
});

function createResponse(url = 'https://user:secret@incoming.test/path/page?query#fragment') {
  const response = new FetchResponse();
  response.urlList.push(parseURL(url).url!);
  response.status = 201;
  return response;
}

function fixture() {
  const userAgent = new UserAgent();
  const tasks: (() => void)[] = [];
  vi.spyOn(userAgent, 'queueReportingTask').mockImplementation((steps) => { tasks.push(steps); });
  const fetch = vi.spyOn(fetchModule, 'fetch').mockImplementation(() => new FetchController());
  return { userAgent, tasks, fetch, response: createResponse() };
}
