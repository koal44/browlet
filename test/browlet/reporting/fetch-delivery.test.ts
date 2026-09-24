import { afterEach, describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../../src/browlet/bindings';
import type { ReportDeliveryResult } from '../../../src/browlet/reporting/delivery';
import { ReportingEndpoint } from '../../../src/browlet/reporting/endpoint';
import { Realm } from '../../../src/browlet/scripting/realm';
import { navigationAndTraversalTaskSource } from '../../../src/browlet/scripting/tasks';
import { utf8Decode } from '../../../src/encoding/codecs/utf-8';
import { FetchBody } from '../../../src/fetch/body';
import { FetchParams } from '../../../src/fetch/params';
import { FetchResponse } from '../../../src/fetch/response';
import { ParallelQueue } from '../../../src/infra/parallel-queue';
import { serializeOrigin } from '../../../src/url/origin';
import { parseURL } from '../../../src/url/url';

afterEach(() => vi.restoreAllMocks());

describe('Reporting through Fetch', () => {
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
