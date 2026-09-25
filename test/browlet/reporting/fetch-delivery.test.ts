import { createServer, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../../src/browlet/bindings';
import type { ReportDeliveryResult } from '../../../src/browlet/reporting/delivery';
import { ReportingEndpoint } from '../../../src/browlet/reporting/endpoint';
import { ReportImpl } from '../../../src/browlet/reporting/report';
import { Realm } from '../../../src/browlet/scripting/realm';
import { navigationAndTraversalTaskSource } from '../../../src/browlet/scripting/tasks';
import { utf8Decode } from '../../../src/encoding/codecs/utf-8';
import { FetchBody } from '../../../src/fetch/body';
import { FetchParams } from '../../../src/fetch/params';
import { FetchResponse } from '../../../src/fetch/response';
import { ParallelQueue } from '../../../src/infra/parallel-queue';
import { serializeOrigin } from '../../../src/url/origin';
import { parseURL } from '../../../src/url/url';
import { closeServer, listen } from '../loader/http-fixture';
import { observe } from '../streams/implementation-fixture';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('Reporting through Fetch', () => {
  it.each([204, 410, 503])('delivers a report over HTTP and handles collector status %s', async (status) => {
    const requests: { method: string; origin: string | undefined; body: string; }[] = [];
    const server = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => { body += chunk; });
      request.on('end', () => {
        requests.push({ method: request.method!, origin: request.headers.origin, body });
        response.writeHead(request.method === 'OPTIONS' ? 204 : status, {
          'Access-Control-Allow-Origin': 'https://source.test',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'content-type',
        });
        response.end();
      });
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browlet = new Browlet({ route: () => '' });
    await browlet.navigate('https://source.test/page');
    const env = getRelevantRealm(browlet.window).env;
    cleanup.push(() => env.userAgent.httpTransport.close());
    const scope = env.getWindowOrWorkerGlobalScopeMixin();
    const endpoint = new ReportingEndpoint('default', parseURL(`${origin}/reports`).url!);
    endpoint.failures = 2;
    scope.reportingEndpoints.push(endpoint);
    scope.queueReport('test', 'default', { message: 'over the network' });
    scope.handoffReports();
    await expect.poll(() => status === 410 ? scope.reportingEndpoints.length : endpoint.failures)
      .toBe(status === 503 ? 3 : 0);
    expect(requests.map((request) => [request.method, request.origin])).toEqual([
      ['OPTIONS', 'https://source.test'], ['POST', 'https://source.test'],
    ]);
    expect(JSON.parse(requests[1]!.body)).toMatchObject([{
      type: 'test', url: 'https://source.test/page', body: { message: 'over the network' },
    }]);
  });

  it('finishes an HTTP upload and receives its result after the generating Document is destroyed', async () => {
    const received = Promise.withResolvers<ServerResponse>();
    const server = createServer((request, response) => {
      request.resume();
      request.on('end', () => received.resolve(response));
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browlet = new Browlet({ route: () => '' });
    await browlet.navigate(`${origin}/page`);
    const realm = getRelevantRealm(browlet.window);
    const { env } = realm;
    cleanup.push(() => env.userAgent.httpTransport.close());
    const endpoint = new ReportingEndpoint('default', parseURL(`${origin}/reports`).url!);
    const report = new ReportImpl(
      { message: 'survives' }, 'test', 'default', `${origin}/page`, env.origin, env.userAgent.defaultUserAgentValue,
    );
    const delivery = observe(env.userAgent.attemptReportDelivery(endpoint, env.origin, [report]));
    const response = await received.promise;
    await new Promise<void>((resolve) => realm.queueGlobalTask(navigationAndTraversalTaskSource, () => {
      realm.getAssociatedDocument().destroy(); resolve();
    }));
    response.writeHead(204); response.end();
    expect(await delivery).toBe('success');
    expect(report.attempts).toBe(1);
  });

  it('releases a collector response body that Reporting never consumes', async () => {
    let closed = false;
    const server = createServer((_request, response) => {
      response.on('close', () => { closed = true; });
      response.writeHead(200); response.write('unused body');
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browlet = new Browlet({ route: () => '' });
    await browlet.navigate(`${origin}/page`);
    const env = getRelevantRealm(browlet.window).env;
    cleanup.push(() => env.userAgent.httpTransport.close());
    const endpoint = new ReportingEndpoint('default', parseURL(`${origin}/reports`).url!);
    expect(await observe(env.userAgent.attemptReportDelivery(endpoint, env.origin, []))).toBe('success');
    await expect.poll(() => closed).toBe(true);
  });

  it.each(['before dispatch', 'while awaiting the response'])(
    'finishes browser-owned delivery when the generating Document is destroyed %s', async (destruction) => {
      const browlet = new Browlet({ route: () => '' });
      await browlet.navigate('https://source.test/page');
      const realm = getRelevantRealm(browlet.window);
      const env = realm.env;
      const { userAgent } = env;
      const document = realm.getAssociatedDocument();
      const scope = env.getWindowOrWorkerGlobalScopeMixin();
      const endpoint = new ReportingEndpoint('default', parseURL('https://collector.test/reports').url!);
      endpoint.failures = 2;
      scope.reportingEndpoints.push(endpoint);
      scope.queueReport('test', 'default', { message: 'survives destruction' });

      const upload = Promise.withResolvers<{ params: FetchParams; bytes: Uint8Array; }>();
      const response = userAgent.hostPromises.withResolvers<FetchResponse>();
      // Fetch entry, policy checks, byte-stream construction, handover, and
      // scheduling are real. Only the later network-dispatch slice is controlled.
      vi.spyOn(FetchParams.prototype, 'httpFetch').mockImplementation(function(this: FetchParams) {
        const body = this.request.body as FetchBody;
        body.fullyRead((bytes) => upload.resolve({ params: this, bytes }), upload.reject, this.env.exec.global);
        return response.promise;
      });
      const delivered = Promise.withResolvers<ReportDeliveryResult>();
      const attemptDelivery = userAgent.attemptReportDelivery.bind(userAgent);
      vi.spyOn(userAgent, 'attemptReportDelivery').mockImplementation((...args) => {
        const result = attemptDelivery(...args);
        result.observe(delivered.resolve, delivered.reject);
        return result;
      });
      const destroyed = Promise.withResolvers<void>();
      const destroy = () => realm.queueGlobalTask(navigationAndTraversalTaskSource, () => {
        document.destroy();
        destroyed.resolve();
      });

      if (destruction === 'before dispatch') {
        destroy();
      } else {
        scope.handoffReports();
        await upload.promise;
        destroy();
      }
      await destroyed.promise;
      expect(document.browsingContext).toBeNull();
      expect(scope.reports).toEqual([]);
      expect(scope.reportBuffer).toEqual([]);
      expect(scope.reportingEndpoints).toEqual([]);

      const { params, bytes } = await upload.promise;
      const { request } = params;
      expect(params.env).toBe(userAgent.sandbox);
      expect(params.env).not.toBe(env);
      const sandboxRealm = Realm.getAssociatedRealm(params.env.exec.global)!;
      expect(sandboxRealm.agent).not.toBe(realm.agent);
      expect(sandboxRealm.getAssociatedDocument()).toBeNull();
      expect(params.taskDestination).toBeInstanceOf(ParallelQueue);
      expect(request.client).toBeNull();
      expect(request.origin).toBeDefined();
      expect(serializeOrigin(request.origin!)).toBe('https://source.test');
      expect(request.userAgent).toBe(userAgent);
      expect(request.body).toBeInstanceOf(FetchBody);
      expect(JSON.parse(utf8Decode(bytes))).toMatchObject([{
        type: 'test', url: 'https://source.test/page', body: { message: 'survives destruction' },
      }]);
      const completed = Promise.withResolvers<void>();
      params.processResponseEndOfBody = () => completed.resolve();
      const result = new FetchResponse();
      result.status = 204;
      // Settle on the host after destruction; Fetch must enter the sandbox to
      // process the response and then deliver Reporting's parallel callback.
      response.resolve(result);
      expect(await delivered.promise).toBe('success');
      await completed.promise;
      expect(request.done).toBe(true);
      expect(endpoint.failures).toBe(0);
    },
  );
});
