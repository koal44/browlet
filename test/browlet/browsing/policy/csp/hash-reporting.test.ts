import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBindingContext, getRelevantRealm } from '../../../../../src/browlet/bindings';
import { Browlet } from '../../../../../src/browlet/browlet';
import { CSPList } from '../../../../../src/browlet/browsing/policy/csp/list';
import { ContentSecurityPolicy } from '../../../../../src/browlet/browsing/policy/csp/policy';
import { ReportImpl } from '../../../../../src/browlet/reporting/report';
import type { Environment } from '../../../../../src/browlet/scripting/environment';
import { networkingTaskSource } from '../../../../../src/browlet/scripting/tasks';
import { FetchBody } from '../../../../../src/fetch/body';
import { FetchRequest } from '../../../../../src/fetch/request';
import { FetchResponse, ResponseImpl } from '../../../../../src/fetch/response';
import { utf8Encode } from '../../../../../src/encoding/index';
import { ReadableStreamImpl } from '../../../../../src/streams/readable-stream';
import { obtainURLOrigin, parseURL, serializeURL } from '../../../../../src/url/url';

afterEach(() => vi.restoreAllMocks());

const sha256ABC = 'sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=';
const sha384ABC = 'sha384-ywB1P0WjXou1oD1pmsZQBycsMqsO3tFjGotgWkP/W+2AhgcroefMI1i67KE0yCWn';
const sha512ABC = 'sha512-3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw==';

describe('CSP hash reports', () => {
  it('reports completed bytes while preserving the consumer body', async () => {
    const { env, request, response, scope } = createHashResponse();
    const reported = waitForHashReports(env);
    response.body = FetchBody.fromBytes(utf8Encode('abc'), env);
    expect(response.isBlockedByCSP(request)).toBe(false);
    expect(scope.reports).toHaveLength(0);
    expect(response.body.stream.locked).toBe(false);
    expect(response.body.stream.disturbed).toBe(false);
    const read = new Promise<Uint8Array>((resolve, reject) => response.body!.readAll(resolve, reject, env.global));
    const [received] = await Promise.all([read, reported]);
    expect([...received]).toEqual([97, 98, 99]);
    expect(scope.reports).toHaveLength(1);
    expect(scope.reports[0]).toMatchObject({
      type: 'csp-hash', destination: 'hashes', body: null,
      data: {
        documentURL: 'https://protected.test/page', subresourceURL: 'https://resource.test/file',
        hash: sha256ABC, destination: 'script', type: 'subresource',
      },
    });
    const serialized = JSON.parse(new TextDecoder().decode(ReportImpl.serialize(scope.reports))) as { body: unknown; }[];
    expect(serialized[0]!.body).toEqual(scope.reports[0]!.data);
  });

  it.each([
    ["'report-sha256'", sha256ABC],
    ["'report-sha384'", sha384ABC],
    ["'report-sha512'", sha512ABC],
    ["'report-sha384' 'report-sha256'", sha384ABC],
    ["'report-sha512' 'report-sha256' 'report-sha384'", sha512ABC],
  ])('selects the strongest requested algorithm from %s', async (sources, hash) => {
    const { env, request, response, scope } = createHashResponse(`script-src https: ${sources}; report-to hashes`);
    const reported = waitForHashReports(env);
    response.body = FetchBody.fromBytes(utf8Encode('abc'), env);
    response.isBlockedByCSP(request);
    await reported;
    expect(scope.reports.map((report) => report.data)).toEqual([expect.objectContaining({ hash })]);
  });

  it('treats a null body as an empty byte sequence', () => {
    const { request, response, scope } = createHashResponse();
    response.isBlockedByCSP(request);
    expect(scope.reports[0]!.data).toMatchObject({ hash: 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=' });
  });

  it('waits for the whole stream rather than hashing an initial chunk', async () => {
    const { env, realm, request, response, scope } = createHashResponse();
    const reported = waitForHashReports(env);
    const stream = ReadableStreamImpl.createWithByteReadingSupport(undefined, undefined, 0, env);
    response.body = new FetchBody(stream, env);
    response.isBlockedByCSP(request);
    await new Promise<void>((resolve) => realm.queueGlobalTask(networkingTaskSource, () => {
      stream.enqueueChunk(env.exec.buffers.copyUint8Array(utf8Encode('a')));
      resolve();
    }));
    expect(scope.reports).toHaveLength(0);
    realm.queueGlobalTask(networkingTaskSource, () => {
      stream.enqueueChunk(env.exec.buffers.copyUint8Array(utf8Encode('bc')));
      stream.close();
    });
    await reported;
    expect(scope.reports[0]!.data).toMatchObject({ hash: sha256ABC });
  });

  it('sanitizes captured document and original resource URLs without mutating them', async () => {
    const { env, document, request, response, scope } = createHashResponse();
    const reported = waitForHashReports(env);
    document.url = parseURL('https://alice:secret@protected.test/page?query#fragment').url!;
    request.urlList = [parseURL('https://bob:secret@resource.test/file?query#fragment').url!];
    request.urlList.push(parseURL('https://private.test/redirected').url!);
    response.urlList = [request.currentURL];
    response.body = FetchBody.fromBytes(utf8Encode('abc'), env);
    response.isBlockedByCSP(request);
    expect(serializeURL(document.url)).toBe('https://alice:secret@protected.test/page?query#fragment');
    expect(serializeURL(request.url)).toBe('https://bob:secret@resource.test/file?query#fragment');
    document.url = parseURL('https://protected.test/changed').url!;
    request.url.path = ['changed'];
    await reported;
    expect(scope.reports[0]!.data).toMatchObject({
      documentURL: 'https://protected.test/page?query', subresourceURL: 'https://resource.test/file?query', hash: sha256ABC,
    });
  });

  it.each(['enforce', 'report'] as const)('uses script fallback and report-to endpoints for %s policies', async (disposition) => {
    const { env, request, response, scope } = createHashResponse(
      "default-src https: 'report-sha256'; report-to first second", disposition,
    );
    const reported = waitForHashReports(env, 2);
    response.body = FetchBody.fromBytes(utf8Encode('abc'), env);
    expect(response.isBlockedByCSP(request)).toBe(false);
    await reported;
    expect(scope.reports.map((report) => report.destination)).toEqual(['first', 'second']);
    expect(scope.reports.map((report) => report.data)).toEqual([
      expect.objectContaining({ hash: sha256ABC }), expect.objectContaining({ hash: sha256ABC }),
    ]);
  });

  it('reports independent policies without consuming another policy or the page body', async () => {
    const { env, document, request, response, scope } = createHashResponse();
    const reported = waitForHashReports(env, 2);
    document.policyContainer.cspList!.policies.push(ContentSecurityPolicy.parse(
      "script-src https: 'report-sha512'; report-to monitored", 'header', 'report',
    ));
    request.policyContainer = document.policyContainer.clone();
    response.body = FetchBody.fromBytes(utf8Encode('abc'), env);
    response.isBlockedByCSP(request);
    const read = new Promise<Uint8Array>((resolve, reject) => response.body!.readAll(resolve, reject, env.global));
    const [received] = await Promise.all([read, reported]);
    expect([...received]).toEqual([97, 98, 99]);
    expect(scope.reports).toHaveLength(2);
    expect(scope.reports.find((report) => report.destination === 'hashes')?.data).toMatchObject({ hash: sha256ABC });
    expect(scope.reports.find((report) => report.destination === 'monitored')?.data).toMatchObject({ hash: sha512ABC });
  });

  it('keeps hash reports invisible to live and buffered ReportingObservers', () => {
    const { window, request, response, scope } = createHashResponse();
    const callback = vi.fn();
    const observer = new window.ReportingObserver(callback);
    observer.observe();
    response.isBlockedByCSP(request);
    expect(scope.reports).toHaveLength(1);
    expect(observer.takeRecords()).toEqual([]);
    const buffered = new window.ReportingObserver(callback, { buffered: true, types: ['csp-hash'] });
    buffered.observe();
    expect(buffered.takeRecords()).toEqual([]);
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('CSP hash disclosure and read failures', () => {
  it.each(['default', 'basic', 'cors'] as const)('allows a digest for a %s response', (type) => {
    const { request, response, scope } = createHashResponse();
    response.type = type;
    request.responseTainting = type === 'cors' ? 'cors' : 'basic';
    response.isBlockedByCSP(request);
    expect(scope.reports[0]!.data).toHaveProperty('hash', expect.stringMatching(/^sha256-.+/));
  });

  it.each(['default', 'opaque', 'opaqueredirect'] as const)('withholds an opaque digest without reading the %s body', (type) => {
    const { env, request, response, scope } = createHashResponse();
    response.type = type;
    if (type === 'default') request.responseTainting = 'opaque';
    const stream = ReadableStreamImpl.createWithByteReadingSupport(undefined, undefined, 0, env);
    response.body = new FetchBody(stream, env);
    response.isBlockedByCSP(request);
    expect(scope.reports[0]!.data).toMatchObject({ hash: '' });
    expect(response.body.stream).toBe(stream);
    expect(stream.locked || stream.disturbed).toBe(false);
  });

  it('does not report a digest of a partially read, failed body', async () => {
    const { env, realm, window, request, response, scope } = createHashResponse();
    const stream = ReadableStreamImpl.createWithByteReadingSupport(undefined, undefined, 0, env);
    response.body = new FetchBody(stream, env);
    response.isBlockedByCSP(request);
    const failure = new window.TypeError('Network read failed');
    const read = new Promise<Uint8Array>((resolve, reject) => response.body!.readAll(resolve, reject, env.global));
    const rejected = expect(read).rejects.toBe(failure);
    realm.queueGlobalTask(networkingTaskSource, () => stream.enqueueChunk(env.exec.buffers.copyUint8Array(utf8Encode('a'))));
    realm.queueGlobalTask(networkingTaskSource, () => stream.error(failure));
    await rejected;
    expect(scope.reports).toHaveLength(0);
    expect(response.body.stream.isErrored).toBe(true);
  });

  it.each(['no algorithm', 'no report-to', 'empty report-to', 'opt out', 'no client', 'not script', 'network error'])(
    'does not touch the body when there is %s', (reason) => {
      const policy = reason === 'no algorithm' ? 'script-src https:; report-to hashes' :
        reason === 'no report-to' ? "script-src https: 'report-sha256'; report-uri /reports" :
        reason === 'empty report-to' ? "script-src https: 'report-sha256'; report-to" : undefined;
      const { env, request, response, scope } = createHashResponse(policy);
      if (reason === 'opt out') env.userAgent.reportDeliveryEnabled = false;
      if (reason === 'no client') request.client = null;
      if (reason === 'not script') request.destination = 'image';
      if (reason === 'network error') response.type = 'error';
      const stream = ReadableStreamImpl.createWithByteReadingSupport(undefined, undefined, 0, env);
      response.body = new FetchBody(stream, env);
      response.isBlockedByCSP(request);
      expect(scope.reports).toHaveLength(0);
      expect(response.body.stream).toBe(stream);
      expect(stream.locked || stream.disturbed).toBe(false);
    },
  );
});

describe('CSP hash reporting through the running browser', () => {
  it('completes both the report and the page read without manual checkpoints', async () => {
    const browlet = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browlet.window);
    const env = realm.env;
    env.policyContainer.cspList = new CSPList(env.origin);
    env.policyContainer.cspList.policies.push(ContentSecurityPolicy.parse(
      "script-src https: 'report-sha256'; report-to hashes", 'header', 'enforce',
    ));
    const request = new FetchRequest(parseURL('https://resource.test/script').url!, env, env.userAgent);
    request.destination = 'script';
    request.populateFromClient();
    const response = new FetchResponse();
    response.urlList = [request.url];
    response.body = FetchBody.fromBytes(utf8Encode('abc'), env);
    const reported = waitForHashReports(env);
    Reflect.set(browlet.window, 'scriptResponse', getBindingContext(realm).project(
      ResponseImpl, new ResponseImpl(response, 'immutable', env),
    ));
    await browlet.exposeFunction('checkCSP', () => response.isBlockedByCSP(request));
    const read = browlet.evaluate(() => {
      const checkCSP = Reflect.get(globalThis, 'checkCSP') as () => Promise<boolean>;
      const scriptResponse = Reflect.get(globalThis, 'scriptResponse') as Response;
      return checkCSP().then(() => scriptResponse.text());
    });
    const [text] = await Promise.all([read, reported]);
    expect(text).toBe('abc');
    expect(env.getWindowOrWorkerGlobalScopeMixin().reports).toHaveLength(1);
    expect(env.getWindowOrWorkerGlobalScopeMixin().reports[0]!.data).toMatchObject({ hash: sha256ABC });
  });
});

function createHashResponse(
  serialized = "script-src https: 'report-sha256'; report-to hashes", disposition: 'enforce' | 'report' = 'enforce',
) {
  const browlet = new Browlet({ route: () => '' });
  const realm = getRelevantRealm(browlet.window);
  const env = realm.env;
  const document = realm.windowImplementation.document;
  document.url = parseURL('https://protected.test/page#section').url!;
  document.origin = obtainURLOrigin(document.url);
  env.creationURL = document.url;
  document.policyContainer.cspList = new CSPList(document.origin);
  document.policyContainer.cspList.policies.push(ContentSecurityPolicy.parse(serialized, 'header', disposition));
  const request = new FetchRequest(parseURL('https://resource.test/file').url!, env, env.userAgent);
  request.destination = 'script';
  request.populateFromClient();
  const response = new FetchResponse();
  response.urlList = [request.url];
  return {
    env, realm, document, request, response,
    window: browlet.window as unknown as Window & typeof globalThis,
    scope: env.getWindowOrWorkerGlobalScopeMixin(),
  };
}

/** Observe submission without replacing generation, queues, or the browser scheduler. */
function waitForHashReports(env: Environment, count = 1): Promise<void> {
  const submitReport = env.queueReport.bind(env);
  return new Promise((resolve) => {
    vi.spyOn(env, 'queueReport').mockImplementation((type, endpoint, body) => {
      submitReport(type, endpoint, body);
      if (type === 'csp-hash' && --count === 0) resolve();
    });
  });
}
