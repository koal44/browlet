import { describe, expect, it } from 'vitest';
import { BodyMixin } from '../../src/fetch/body';
import { FetchParams } from '../../src/fetch/params';
import { RequestImpl, RequestRecord } from '../../src/fetch/request';
import { ResponseImpl, ResponseRecord } from '../../src/fetch/response';
import { FetchTimingInfo, ResponseBodyInfo } from '../../src/fetch/timing';
import { parseURL } from '../../src/url/url';
import type { BindingContext } from '../../src/web-idl/projection';
import { TestRealm } from '../web-idl/test-realm';
import { createRecordFixture, createRequestRecord } from './record-fixture';

describe('Fetch request and response records', () => {
  it('starts a request with the §2.2.5 defaults and retains its supplied client', () => {
    const client = {};
    const request = createRequestRecord(undefined, client);
    expect(request).toMatchObject({
      method: 'GET', localURLsOnly: false, headerList: [], unsafeRequest: false, body: null,
      client, reservedClient: null, replacesClientId: '', traversableForUserPrompts: 'client',
      keepalive: false, initiatorType: null, serviceWorkersMode: 'all', initiator: '', destination: '',
      priority: 'auto', internalPriority: null, origin: 'client', topLevelNavigationInitiatorOrigin: null,
      policyContainer: 'client', referrer: 'client', referrerPolicy: '', mode: 'no-cors',
      useCORSPreflight: false, credentialsMode: 'same-origin', useURLCredentials: false,
      cacheMode: 'default', redirectMode: 'follow', integrityMetadata: '', cryptographicNonceMetadata: '',
      parserMetadata: '', reloadNavigation: false, historyNavigation: false, userActivation: false,
      webDriverNavigationId: null, renderBlocking: false, webTransportHashList: [], redirectCount: 0,
      responseTainting: 'basic', preventNoCacheCacheControlHeaderModification: false, done: false,
      timingAllowFailed: false, navigationTimingAllowValuesList: [],
    });
    expect(request.client).toBe(client);
    expect(request.urlList).toHaveLength(1);
    expect(request.url).toBe(request.currentURL);
    expect(request.webDriverId).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  });

  it('keeps URL/current URL as live pointers and copies the initial URL components', () => {
    const url = parseURL('https://[::1]/start#fragment').url!;
    const request = new RequestRecord(url, null);
    expect(request.url).toEqual(url);
    expect(request.url).not.toBe(url);
    expect(request.url.path).not.toBe(url.path);
    expect(request.url.host).not.toBe(url.host);
    if (url.host?.kind !== 'ipv6' || request.url.host?.kind !== 'ipv6') throw new Error('Expected IPv6');
    expect(request.url.host.pieces).not.toBe(url.host.pieces);

    const redirect = parseURL('https://example.test/redirect').url!;
    request.urlList.push(redirect);
    expect(request.url).toBe(request.urlList[0]);
    expect(request.currentURL).toBe(redirect);
    expect(request.url.fragment).toBe('fragment');
    expect(request.webDriverId).not.toBe(createRequestRecord().webDriverId);
  });

  it('starts a response with §2.2.6 defaults and a URL derived from its list', () => {
    const response = new ResponseRecord();
    expect(response).toEqual({
      type: 'default', aborted: false, urlList: [], status: 200, statusMessage: '', headerList: [],
      body: null, cacheState: '', corsExposedHeaderNameList: [], rangeRequested: false,
      requestIncludesCredentials: true, timingAllowPassed: false, navigationTimingAllowValuesList: [],
      bodyInfo: new ResponseBodyInfo(), serviceWorkerTimingInfo: null, redirectTaint: 'same-origin',
    });
    expect(response.url).toBeNull();
    const url = createRequestRecord().url;
    response.urlList.push(url);
    expect(response.url).toBe(url);
  });

  it('does not share mutable defaults between independent records', () => {
    const request = createRequestRecord();
    request.headerList.push(['X-Example', 'one']);
    request.webTransportHashList.push({ algorithm: 'sha-256', value: Uint8Array.of(1) });
    request.navigationTimingAllowValuesList.push(['*']);
    expect(createRequestRecord()).toMatchObject({ headerList: [], webTransportHashList: [], navigationTimingAllowValuesList: [] });

    const response = new ResponseRecord();
    response.headerList.push(['Set-Cookie', 'one']);
    response.urlList.push(request.url);
    response.bodyInfo.encodedSize = 42;
    response.corsExposedHeaderNameList.push('x-example');
    expect(new ResponseRecord()).toMatchObject({ headerList: [], urlList: [], bodyInfo: { encodedSize: 0 }, corsExposedHeaderNameList: [] });
  });
});

describe('Fetch record/API sharing', () => {
  it('retains the same request, signal, and duplicate-preserving Headers list', () => {
    const fixture = createRecordFixture();
    const record = createRequestRecord();
    // Only signal identity is exercised here; DOM-dependent creation comes later.
    const signal = {};
    const request = fixture.createRequest(record, signal);
    expect(request.getRequest()).toBe(record);
    expect(request.signal).toBe(signal);
    expect(request.headers).toBe(request.headers);
    expect(request.headers.headerList).toBe(record.headerList);
    expect(request.headers.guard).toBe('request');
    record.headerList.push(['X-Example', 'first'], ['X-Example', 'second']);
    expect(request.headers.headerList).toEqual([['X-Example', 'first'], ['X-Example', 'second']]);
    record.method = 'POST';
    expect(request.method).toBe('POST');
    expect(request.referrer).toBe('about:client');
    record.referrer = 'no-referrer';
    expect(request.referrer).toBe('');
    expect(request.body).toBeNull();
    expect(request.bodyUsed).toBe(false);
    record.body = fixture.createBody();
    expect(request.body).toBe(record.body.stream);
  });

  it('keeps the response view live', () => {
    const fixture = createRecordFixture();
    const record = new ResponseRecord();
    const response = fixture.createResponse(record, 'immutable');
    expect(response.getResponse()).toBe(record);
    expect(response.headers.headerList).toBe(record.headerList);
    expect(response.headers.guard).toBe('immutable');
    expect(fixture.bindings.getRealm(response)).toBe(fixture.realm);
    record.status = 404;
    record.statusMessage = 'Not Found';
    record.urlList.push(createRequestRecord().url, createRequestRecord('https://example.test/end#hidden').url);
    expect(response.status).toBe(404);
    expect(response.statusText).toBe('Not Found');
    expect(response.ok).toBe(false);
    expect(response.redirected).toBe(true);
    expect(response.url).toBe('https://example.test/end');
    expect(response.body).toBeNull();
  });

  it.each(['Request', 'Response'])('projects %s Headers in the receiver realm through a borrowed getter', (name) => {
    const fixture = createRecordFixture();
    const foreignRealm = new TestRealm();
    const foreign = fixture.bindings.register(foreignRealm);
    const createObject = (context: BindingContext) => name === 'Request'
      ? context.project(RequestImpl, context.construct(RequestImpl, createRequestRecord(), 'request', {}))
      : context.project(ResponseImpl, context.construct(ResponseImpl, new ResponseRecord(), 'response'));
    const receiver = createObject(fixture.context);
    const foreignReceiver = createObject(foreign.context);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Borrowing the getter is the behavior under test.
    const getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(foreignReceiver), 'headers')?.get;
    if (!getter) throw new Error('Missing Headers getter');

    // The borrowed getter is the first path to expose the receiver's Headers.
    const headers = Reflect.apply(getter, receiver, []) as object;
    expect(fixture.bindings.getRealm(headers)).toBe(fixture.realm);
    expect(Reflect.get(receiver, 'headers')).toBe(headers);
    const foreignHeaders = Reflect.apply(getter, foreignReceiver, []) as object;
    expect(fixture.bindings.getRealm(foreignHeaders)).toBe(foreignRealm);
    expect(foreignHeaders).not.toBe(headers);
  });

  it('reads replacement bodies and stream state through the same mixin', () => {
    const fixture = createRecordFixture();
    const record = new ResponseRecord();
    const response = fixture.createResponse(record);
    const mixin = new BodyMixin(record);
    const first = fixture.createBody();
    expect(first.source).toBeNull();
    expect(first.length).toBeNull();
    record.body = first;
    expect(response.body).toBe(first.stream);
    const reader = first.stream.getDefaultReader();
    expect(mixin.unusable).toBe(true);
    expect(response.bodyUsed).toBe(false);
    reader.readChunk({ chunkSteps() {}, closeSteps() {}, errorSteps() {} });
    expect(response.bodyUsed).toBe(true);
    reader.release();
    const second = fixture.createBody();
    record.body = second;
    expect(response.body).toBe(second.stream);
    expect(response.bodyUsed).toBe(false);
    expect(mixin.unusable).toBe(false);
    record.body = null;
    expect(response.body).toBeNull();
  });
});

describe('Fetch params', () => {
  it('retains request/timing references and derives cancellation from the controller', () => {
    const request = createRequestRecord();
    const timing = new FetchTimingInfo();
    const params = new FetchParams(request, timing);
    expect(params).toMatchObject({
      processRequestBodyChunkLength: null, processRequestEndOfBody: null,
      processEarlyHintsResponse: null, processResponse: null, processResponseEndOfBody: null,
      processResponseConsumeBody: null, taskDestination: null, crossOriginIsolatedCapability: false,
      preloadedResponseCandidate: null,
    });
    expect(params.request).toBe(request);
    expect(params.timingInfo).toBe(timing);
    expect(params.controller).not.toBe(new FetchParams(request, timing).controller);
    expect(params.canceled).toBe(false);
    expect(params.aborted).toBe(false);
    params.controller.terminate();
    expect(params.canceled).toBe(true);
    expect(params.aborted).toBe(false);
    params.controller.state = 'aborted';
    expect(params.aborted).toBe(true);
  });
});
