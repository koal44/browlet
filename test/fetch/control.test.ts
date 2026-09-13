import { describe, expect, it, vi } from 'vitest';

import { FetchController } from '../../src/fetch/controller';
import { isOffline, serializeInteger } from '../../src/fetch/infrastructure';
import { queueFetchTask } from '../../src/fetch/tasks';
import {
  ConnectionTimingInfo, FetchTimingInfo, ResponseBodyInfo,
} from '../../src/fetch/timing';
import {
  isFetchScheme, isHTTPScheme, isLocalScheme, isLocalURL,
} from '../../src/fetch/url';
import { ParallelQueue } from '../../src/infra/parallel-queue';
import { parseURL } from '../../src/url/url';
import { createRuntime } from '../js-engine/runtime-fixture';
import { createControllerFixture } from './control-fixture';

describe('Fetch §2 controllers', () => {
  it('starts ongoing with no timing, redirect steps, or serialized abort reason', () => {
    expect(new FetchController()).toEqual({
      state: 'ongoing',
      fullTimingInfo: null,
      reportTimingSteps: null,
      serializedAbortReason: null,
      nextManualRedirectSteps: null,
    });
  });

  it('reports timing to the supplied global and exposes the retained full record', () => {
    const controller = new FetchController();
    const global = {};
    const timing = new FetchTimingInfo();
    timing.startTime = 42;
    controller.fullTimingInfo = timing;
    controller.reportTimingSteps = vi.fn();
    controller.nextManualRedirectSteps = vi.fn();

    controller.reportTiming(global);
    controller.processNextManualRedirect();

    expect(controller.reportTimingSteps).toHaveBeenCalledExactlyOnceWith(global);
    expect(controller.nextManualRedirectSteps).toHaveBeenCalledExactlyOnceWith();
    expect(controller.extractFullTimingInfo()).toBe(timing);
  });

  it('requires the steps and full timing info prescribed by the algorithms', () => {
    const controller = new FetchController();
    expect(() => controller.reportTiming({})).toThrow('timing steps are not set');
    expect(() => controller.processNextManualRedirect()).toThrow('redirect steps are not set');
    expect(() => controller.extractFullTimingInfo()).toThrow('full timing info is not set');
  });

  it('sets aborted before serialization and retains only the serialized record', () => {
    const error = {};
    const record = {};
    const { controller, abort } = createControllerFixture({
      ...createRuntime(),
      serialize(value) {
        expect(controller.state).toBe('aborted');
        expect(controller.serializedAbortReason).toBeNull();
        expect(value).toBe(error);
        return record;
      },
      deserialize: vi.fn(),
    });
    abort(error);
    expect(controller.serializedAbortReason).toBe(record);

    controller.terminate();
    expect(controller.state).toBe('terminated');
    expect(controller.serializedAbortReason).toBe(record);
  });

  it('does not add a once-only restriction to abort or terminate', () => {
    const { controller, abort } = createControllerFixture({
      ...createRuntime(),
      serialize: (value) => ({ value }),
      deserialize: vi.fn(),
    });
    controller.terminate();
    abort('first');
    abort('second');
    expect(controller.state).toBe('aborted');
    expect(controller.serializedAbortReason).toEqual({ value: 'second' });
  });

  it('keeps an omitted abort error distinct from an explicitly supplied undefined', () => {
    const serialize = vi.fn((value: unknown) => ({ value }));
    const { abort } = createControllerFixture({ ...createRuntime(), serialize, deserialize: vi.fn() });

    abort();
    expect(serialize.mock.calls[0]![0]).toMatchObject({ name: 'AbortError' });
    abort(undefined);
    expect(serialize.mock.calls[1]![0]).toBeUndefined();
  });

  it('falls back to AbortError if deserialization throws', () => {
    const { deserialize } = createControllerFixture({
      ...createRuntime(),
      serialize: vi.fn(),
      deserialize: () => { throw new Error('Unavailable serialized type'); },
    });
    const reason = deserialize({});
    expect(reason).toMatchObject({ name: 'AbortError', message: '' });
  });
});

describe('Fetch §2 timing information', () => {
  it('makes opaque timing retain only start time, including post-redirect start', () => {
    const timing = Object.assign(new FetchTimingInfo(), {
      startTime: 1,
      redirectStartTime: 2,
      redirectEndTime: 3,
      postRedirectStartTime: 4,
      finalServiceWorkerStartTime: 5,
      finalNetworkRequestStartTime: 6,
      firstInterimNetworkResponseStartTime: 7,
      finalNetworkResponseStartTime: 8,
      endTime: 9,
      finalConnectionTimingInfo: new ConnectionTimingInfo(),
      serverTimingHeaders: ['db;dur=4'],
      renderBlocking: true,
    });
    const opaque = timing.createOpaque();

    expect(opaque).toEqual({
      startTime: 1,
      redirectStartTime: 0,
      redirectEndTime: 0,
      postRedirectStartTime: 1,
      finalServiceWorkerStartTime: 0,
      finalNetworkRequestStartTime: 0,
      firstInterimNetworkResponseStartTime: 0,
      finalNetworkResponseStartTime: 0,
      endTime: 0,
      finalConnectionTimingInfo: null,
      serviceWorkerTimingInfo: null,
      serverTimingHeaders: [],
      renderBlocking: false,
    });
    expect(timing.postRedirectStartTime).toBe(4);
    expect(timing.serverTimingHeaders).toEqual(['db;dur=4']);
    expect(opaque.serverTimingHeaders).not.toBe(timing.serverTimingHeaders);
  });

  it('keeps timing lists and protocol byte sequences independent between records', () => {
    const first = new FetchTimingInfo();
    const second = new FetchTimingInfo();
    first.serverTimingHeaders.push('db;dur=1');
    expect(second.serverTimingHeaders).toEqual([]);
    const connection = new ConnectionTimingInfo();
    expect(connection).toEqual({
      domainLookupStartTime: 0,
      domainLookupEndTime: 0,
      connectionStartTime: 0,
      connectionEndTime: 0,
      secureConnectionStartTime: 0,
      alpnNegotiatedProtocol: new Uint8Array(),
    });
    expect(connection.alpnNegotiatedProtocol)
      .not.toBe(new ConnectionTimingInfo().alpnNegotiatedProtocol);
    expect(new ResponseBodyInfo()).toEqual({
      encodedSize: 0, decodedSize: 0, contentType: '', contentEncoding: '',
    });
  });
});

describe('Fetch §2 task delivery', () => {
  it('uses the parallel destination FIFO without calling the global-task capability', () => {
    const drains: (() => void)[] = [];
    const queue = new ParallelQueue((steps) => drains.push(steps));
    const queueGlobalTask = vi.fn();
    const order: number[] = [];

    queueFetchTask(() => {
      order.push(1);
      queueFetchTask(() => order.push(3), queue, queueGlobalTask);
    }, queue, queueGlobalTask);
    queueFetchTask(() => order.push(2), queue, queueGlobalTask);
    expect(order).toEqual([]);
    expect(drains).toHaveLength(1);
    drains.shift()!();

    expect(order).toEqual([1, 2, 3]);
    expect(queueGlobalTask).not.toHaveBeenCalled();
  });

  it('passes a global and its algorithm to HTML without running it inline', () => {
    const global = {};
    const algorithm = vi.fn();
    const queueGlobalTask = vi.fn();

    queueFetchTask(algorithm, global, queueGlobalTask);

    expect(queueGlobalTask).toHaveBeenCalledExactlyOnceWith(global, algorithm);
    expect(algorithm).not.toHaveBeenCalled();
  });
});

describe('Fetch §2 offline state and integer serialization', () => {
  it.each([
    [false, false, false], [true, false, true],
    [false, true, true], [true, true, true],
  ])('combines user-agent %s and BiDi %s offline state', (userAgent, bidi, expected) => {
    expect(isOffline(userAgent, bidi)).toBe(expected);
  });

  it.each([
    [0, '0'], [-0, '0'], [42, '42'], [-42, '-42'],
    [Number.MAX_SAFE_INTEGER, '9007199254740991'],
    [1e21, '1000000000000000000000'],
    [12345678901234567890123456789n, '12345678901234567890123456789'],
  ] as const)('serializes %s without exponent notation or padding', (integer, expected) => {
    expect(serializeInteger(integer)).toBe(expected);
  });
});

describe('Fetch §2.1 URL classifications', () => {
  it.each([
    ['about', true, false, true],
    ['blob', true, false, true],
    ['data', true, false, true],
    ['file', false, false, true],
    ['http', false, true, true],
    ['https', false, true, true],
    ['ftp', false, false, false],
    ['ws', false, false, false],
    ['wss', false, false, false],
    ['javascript', false, false, false],
    ['custom', false, false, false],
  ] as const)('classifies the %s scheme', (scheme, local, http, fetch) => {
    expect(isLocalScheme(scheme)).toBe(local);
    expect(isHTTPScheme(scheme)).toBe(http);
    expect(isFetchScheme(scheme)).toBe(fetch);
  });

  it.each([
    ['ABOUT:blank', true], ['data:text/plain,hello', true],
    ['blob:https://example.test/id', true], ['file:///hello.txt', false],
    ['https://example.test/', false],
  ] as const)('classifies a parsed URL %s', (input, local) => {
    expect(isLocalURL(parseURL(input).url!)).toBe(local);
  });
});
