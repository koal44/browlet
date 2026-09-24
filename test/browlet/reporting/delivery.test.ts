import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { utf8Decode } from '../../../src/encoding/codecs/utf-8';
import { getBindingContext, getRelevantRealm } from '../../../src/browlet/bindings';
import { createNewTopLevelTraversable } from '../../../src/browlet/browsing/navigable';
import { navigationAndTraversalTaskSource } from '../../../src/browlet/scripting/tasks';
import { monotonicClock, UnsafeMoment } from '../../../src/browlet/performance/clock';
import { sendReports } from '../../../src/browlet/reporting/delivery';
import { ReportingEndpoint } from '../../../src/browlet/reporting/endpoint';
import { ReportImpl } from '../../../src/browlet/reporting/report';
import { UserAgent } from '../../../src/browlet/user-agent';
import * as Fetch from '../../../src/fetch/fetch';
import { FetchRequest } from '../../../src/fetch/request';
import { FetchController } from '../../../src/fetch/controller';
import { FetchResponse } from '../../../src/fetch/response';
import { createOpaqueOrigin, serializeOrigin } from '../../../src/url/origin';
import { obtainURLOrigin, parseURL, serializeURL } from '../../../src/url/url';
import { isStampedImplInstance } from '../../../src/web-idl/index';
import { PromiseValue } from '../../../src/infra/promises';

// Control network responses while exercising the actual browser-owned scheduler.
const fetchRequest = vi.spyOn(Fetch, 'fetch').mockImplementation(() => new FetchController());
beforeEach(() => { fetchRequest.mockClear(); });
afterAll(() => { fetchRequest.mockRestore(); });

describe('Reporting serialization', () => {
  it('serializes UTF-8 report envelopes without private routing or absolute timestamps', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    try {
      const report = makeReport('https://document.test/page');
      report.timestamp = 8_000;
      report.data = { message: 'snowman ☃', reportOnly: true, nested: [1, null] };
      expect(JSON.parse(utf8Decode(ReportImpl.serialize([report])))).toEqual([{
        age: 2000, type: 'test', url: report.url, user_agent: 'Browlet/test', body: report.data,
      }]);
      expect(utf8Decode(ReportImpl.serialize([]))).toBe('[]');
    } finally {
      clock.mockRestore();
    }
  });

  it('leaves report data and attempt counts unchanged when serializing repeatedly', () => {
    const report = makeReport('https://document.test/');
    report.attempts = 3;
    const before = { ...report };
    ReportImpl.serialize([report]);
    ReportImpl.serialize([report]);
    expect(report).toEqual(before);
  });
});

describe('Reporting delivery', () => {
  it('groups by endpoint identity and source origin, preserving report order within each group', async () => {
    const { userAgent, env, scope } = createWindow();
    const first = new ReportingEndpoint('first', parseURL('https://collector.test/').url!);
    const second = new ReportingEndpoint('second', first.url);
    scope.reportingEndpoints.push(first, second);
    sendReports([
      makeReport('https://a.test/1', 'first'), makeReport('https://a.test/2', 'second'),
      makeReport('https://b.test/3', 'first'), makeReport('https://a.test/4', 'first'),
      makeReport('https://a.test/ignored', 'missing'),
    ], env);
    expect(fetchRequest).not.toHaveBeenCalled();
    await runReportingTasks(userAgent);
    const requests = fetchRequest.mock.calls.map(([request]) => request);
    expect(requests.map((request): unknown => JSON.parse(utf8Decode(request.body as Uint8Array)))).toMatchObject([
      [{ url: 'https://a.test/1' }, { url: 'https://a.test/4' }],
      [{ url: 'https://b.test/3' }], [{ url: 'https://a.test/2' }],
    ]);
    expect(requests.map((request) => serializeOrigin(request.origin!))).toEqual([
      'https://a.test', 'https://b.test', 'https://a.test',
    ]);
  });

  it('passes a clientless Fetch request and parallel response processing to Fetch', async () => {
    const { userAgent, env, scope } = createWindow();
    scope.reportingEndpoints.push(new ReportingEndpoint('default', parseURL('https://collector.test/reports').url!));
    sendReports([makeReport('https://source.test/page')], env);
    await runReportingTasks(userAgent);
    const [request, options] = fetchRequest.mock.calls[0]!;
    expect(request).toBeInstanceOf(FetchRequest);
    expect(serializeURL(request.url)).toBe('https://collector.test/reports');
    expect(request.userAgent).toBe(userAgent);
    expect(request).toMatchObject({
      method: 'POST', client: null, traversableForUserPrompts: null,
      allowServiceWorkerInterception: false, initiator: '', destination: 'report',
      mode: 'cors', unsafeRequest: true, credentialsMode: 'same-origin', priority: 'low',
    });
    expect(options?.useParallelQueue).toBe(true);
    expect(request.headerList.get('Content-Type')).toBe('application/reports+json');
    expect(request.body).toBeInstanceOf(Uint8Array);
    expect(JSON.parse(utf8Decode(request.body as Uint8Array))).toMatchObject([{
      type: 'test', url: 'https://source.test/page', body: { message: 'test' },
    }]);
  });

  it('copies producer data at handoff but measures age when delivery begins', async () => {
    const { userAgent, env, scope } = createWindow();
    scope.reportingEndpoints.push(new ReportingEndpoint('default', parseURL('https://collector.test/').url!));
    const report = makeReport('https://source.test/');
    const body = { nested: { message: 'original' } };
    report.data = body;
    report.timestamp = 8000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(9000);
    try {
      sendReports([report], env);
      body.nested.message = 'changed';
      clock.mockReturnValue(10_000);
      await runReportingTasks(userAgent);
      expect(JSON.parse(utf8Decode(fetchRequest.mock.calls[0]![0].body as Uint8Array))).toMatchObject([{
        age: 2000, body: { nested: { message: 'original' } },
      }]);
    } finally {
      clock.mockRestore();
    }
  });

  it('does not merge distinct opaque origins merely because they serialize as null', async () => {
    const { userAgent, env, scope } = createWindow();
    scope.reportingEndpoints.push(new ReportingEndpoint('default', parseURL('https://collector.test/').url!));
    const first = makeReport('https://source.test/');
    const second = makeReport('https://source.test/');
    first.url = second.url = 'data';
    first.origin = createOpaqueOrigin();
    second.origin = createOpaqueOrigin();
    sendReports([first, second], env);
    await runReportingTasks(userAgent);
    expect(fetchRequest.mock.calls.map(([request]) => request.origin)).toEqual([first.origin, second.origin]);
  });

  it('copies a projected report without retaining its body or binding identity', async () => {
    const { userAgent, realm, env, scope } = createWindow();
    const report = env.generateReport({ message: 'test' }, 'test', 'default');
    const platform = getBindingContext(realm).project(ReportImpl, report);
    Reflect.get(platform, 'body');
    expect(isStampedImplInstance(report)).toBe(true);
    expect(isStampedImplInstance(report.body)).toBe(true);
    report.attempts = 2;
    scope.reportingEndpoints.push(new ReportingEndpoint('default', parseURL('https://collector.test/').url!));
    const cloning = vi.spyOn(report, 'cloneForDelivery');
    sendReports([report], env);
    const copy = cloning.mock.results[0]!.value as ReportImpl;
    expect(copy).toBeInstanceOf(ReportImpl);
    expect(copy).not.toBe(report);
    expect(copy.data).toEqual(report.data);
    expect(copy.data).not.toBe(report.data);
    expect(copy.timestamp).toBe(report.timestamp);
    expect(copy.attempts).toBe(2);
    expect(copy.body).toBeNull();
    expect(isStampedImplInstance(copy)).toBe(false);
    await runReportingTasks(userAgent);
    expect(copy.attempts).toBe(3);
    expect(report.attempts).toBe(2);
  });

  it('keeps equal endpoint URLs from different globals independently configured', async () => {
    const first = createWindow();
    const second = createWindow(first.userAgent);
    const url = parseURL('https://collector.test/').url!;
    first.scope.reportingEndpoints.push(new ReportingEndpoint('default', url));
    second.scope.reportingEndpoints.push(new ReportingEndpoint('default', url));
    sendReports([makeReport('https://source.test/1')], first.env);
    sendReports([makeReport('https://source.test/2')], second.env);
    await runReportingTasks(first.userAgent);
    fetchRequest.mock.calls[0]![1]!.processResponse!(response(410));
    await runReportingTasks(first.userAgent);
    expect(first.scope.reportingEndpoints).toEqual([]);
    expect(second.scope.reportingEndpoints).toHaveLength(1);
    fetchRequest.mock.calls[1]![1]!.processResponse!(response(204));
    await runReportingTasks(first.userAgent);
    expect(second.scope.reportingEndpoints[0]!.failures).toBe(0);
  });

  it('honors opt-out both before handoff and before running the delivery task', async () => {
    const { userAgent, env, scope } = createWindow();
    scope.reportingEndpoints.push(new ReportingEndpoint('default', parseURL('https://collector.test/').url!));
    sendReports([makeReport('https://source.test/1')], env);
    userAgent.reportDeliveryEnabled = false;
    await runReportingTasks(userAgent);
    expect(fetchRequest).not.toHaveBeenCalled();
    sendReports([makeReport('https://source.test/2')], env);
    userAgent.reportDeliveryEnabled = true;
    await runReportingTasks(userAgent);
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it('retires old pending reports and failing endpoints before making requests', async () => {
    const { userAgent, env, scope } = createWindow();
    const endpoint = new ReportingEndpoint('default', parseURL('https://collector.test/').url!);
    scope.reportingEndpoints.push(endpoint);
    const report = makeReport('https://source.test/');
    sendReports([report], env);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(report.timestamp + userAgent.maxReportAge + 1);
    try {
      await runReportingTasks(userAgent);
      expect(fetchRequest).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
    sendReports([makeReport('https://source.test/')], env);
    endpoint.failures = userAgent.maxReportingEndpointFailures + 1;
    await runReportingTasks(userAgent);
    expect(fetchRequest).not.toHaveBeenCalled();
    expect(scope.reportingEndpoints).toEqual([]);
  });

  it('preserves pending delivery across active-document destruction while clearing local state', async () => {
    const { userAgent, traversable, realm, scope } = createWindow();
    const document = traversable.activeDocument!;
    scope.reportingEndpoints.push(new ReportingEndpoint('default', parseURL('https://collector.test/').url!));
    scope.queueReport('coep', 'default', {
      type: 'corp', blockedURL: 'https://resource.test/', destination: 'script', disposition: 'enforce',
    });
    realm.queueGlobalTask(navigationAndTraversalTaskSource, () => { document.destroy(); });
    const eventLoop = realm.agent.eventLoop;
    eventLoop.runTaskTurn({
      createMicrotaskQueue: () => eventLoop.microtaskQueue,
      requestEventLoopTurn: vi.fn(),
      unsafeSharedCurrentTime: () => new UnsafeMoment(monotonicClock, 0),
    });
    expect(scope.reports).toEqual([]);
    expect(scope.reportBuffer).toEqual([]);
    expect(scope.reportingEndpoints).toEqual([]);
    expect(traversable.activeDocument).toBeNull();
    expect(fetchRequest).not.toHaveBeenCalled();
    await runReportingTasks(userAgent);
    const request = fetchRequest.mock.calls[0]![0];
    expect(request.client).toBeNull();
    expect(JSON.parse(utf8Decode(request.body as Uint8Array))).toMatchObject([{
      type: 'coep', url: 'about', body: { type: 'corp' },
    }]);
  });
});

describe('Reporting delivery results', () => {
  it('waits for Fetch and returns a delivery result without updating the endpoint', async () => {
    const userAgent = new UserAgent();
    const endpoint = new ReportingEndpoint('default', parseURL('https://collector.test/').url!);
    endpoint.failures = 3;
    const report = makeReport('https://source.test/');
    const result = userAgent.attemptReportDelivery(endpoint, report.origin, [report]);
    expect(result).toBeInstanceOf(PromiseValue);
    expect(report.attempts).toBe(1);
    const fulfilled = vi.fn();
    result.observe(fulfilled, (error) => { throw error; });
    await runReportingTasks(userAgent);
    expect(fulfilled).not.toHaveBeenCalled();
    fetchRequest.mock.calls[0]![1]!.processResponse!(response(410));
    await runReportingTasks(userAgent);
    expect(fulfilled).toHaveBeenCalledExactlyOnceWith('remove-endpoint');
    expect(endpoint.failures).toBe(3);
  });

  it.each([200, 204, 299])('resets consecutive failures on HTTP %s success', async (status) => {
    const { processResponse, endpoint, scope, userAgent } = await startDelivery();
    endpoint.failures = 3;
    processResponse(response(status));
    await runReportingTasks(userAgent);
    expect(endpoint.failures).toBe(0);
    expect(scope.reportingEndpoints).toEqual([endpoint]);
  });

  it.each([0, 199, 300, 404, 500])('counts HTTP %s or network failure without inventing retries', async (status) => {
    const { processResponse, endpoint, userAgent } = await startDelivery();
    processResponse(response(status));
    await runReportingTasks(userAgent);
    expect(endpoint.failures).toBe(1);
    expect(fetchRequest).toHaveBeenCalledTimes(1);
  });

  it('removes an endpoint on 410 and discards further queued reports for that configuration', async () => {
    const { processResponse, scope, userAgent, env } = await startDelivery();
    sendReports([makeReport('https://source.test/later')], env);
    processResponse(response(410));
    await runReportingTasks(userAgent);
    expect(scope.reportingEndpoints).toEqual([]);
    expect(fetchRequest).toHaveBeenCalledTimes(1);
  });
});

function createWindow(userAgent = new UserAgent()) {
  const traversable = createNewTopLevelTraversable(userAgent, null, '');
  const realm = getRelevantRealm(traversable.activeDocument!);
  const env = realm.env;
  return { userAgent, traversable, realm, env, scope: env.getWindowOrWorkerGlobalScopeMixin() };
}

// Wait through the real host scheduler; no HTML checkpoint is needed for delivery.
function runReportingTasks(userAgent: UserAgent): Promise<void> {
  return new Promise((resolve) => { userAgent.queueReportingTask(resolve); });
}

function makeReport(url: string, destination = 'default'): ReportImpl {
  return new ReportImpl(
    { message: 'test' }, 'test', destination, url, obtainURLOrigin(parseURL(url).url!), 'Browlet/test',
  );
}

async function startDelivery() {
  const result = createWindow();
  const endpoint = new ReportingEndpoint('default', parseURL('https://collector.test/').url!);
  result.scope.reportingEndpoints.push(endpoint);
  sendReports([makeReport('https://source.test/')], result.env);
  await runReportingTasks(result.userAgent);
  return { ...result, endpoint, processResponse: fetchRequest.mock.calls[0]![1]!.processResponse! };
}

function response(status: number): FetchResponse {
  const result = new FetchResponse();
  result.status = status;
  return result;
}
