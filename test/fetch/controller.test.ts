import { describe, expect, it, vi } from 'vitest';
import { FetchController } from '../../src/fetch/controller';
import { FetchParams } from '../../src/fetch/params';
import { FetchTimingInfo } from '../../src/fetch/timing';
import { ParallelQueue } from '../../src/infra/parallel-queue';
import { queueNetworkingTask } from '../../src/js-engine/index';
import { createEnvironment } from '../js-engine/execution-fixture';
import { createControllerFixture } from './controller-fixture';
import { createClientEnvironment } from './client-fixture';
import { createFetchRequest } from './fetch-fixture';

describe('Fetch controller lifecycle', () => {
  it('starts ongoing with no timing, redirect steps, or serialized abort reason', () => {
    expect(new FetchController()).toEqual({
      state: 'ongoing',
      fullTimingInfo: null,
      reportTimingSteps: null,
      serializedAbortReason: null,
      nextManualRedirectSteps: null,
    });
  });

  it('sets aborted before serialization and retains only the serialized record', () => {
    const error = {};
    const record = {};
    const { controller, abort } = createControllerFixture({
      queueNetworkingTask,
      exec: {
        ...createEnvironment().exec,
        serialize(value) {
          expect(controller.state).toBe('aborted');
          expect(controller.serializedAbortReason).toBeNull();
          expect(value).toBe(error);
          return record;
        },
        deserialize: vi.fn(),
      },
    });
    abort(error);
    expect(controller.serializedAbortReason).toBe(record);

    controller.terminate();
    expect(controller.state).toBe('terminated');
    expect(controller.serializedAbortReason).toBe(record);
  });

  it('cancels active operations once, after serializing the abort reason', () => {
    const { controller, abort } = createControllerFixture(createEnvironment());
    const cancel = vi.fn(() => {
      expect(controller.state).toBe('aborted');
      expect(controller.serializedAbortReason).not.toBeNull();
    });
    controller.addCancellationSteps(cancel);
    abort('stop');
    controller.terminate();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('removes completed operations and immediately cancels late registrations', () => {
    const controller = new FetchController();
    const completed = vi.fn();
    controller.addCancellationSteps(completed)();
    controller.terminate();
    expect(completed).not.toHaveBeenCalled();
    const late = vi.fn();
    controller.addCancellationSteps(late);
    expect(late).toHaveBeenCalledOnce();
  });

  it('does not add a once-only restriction to abort or terminate', () => {
    const { controller, abort } = createControllerFixture({
      queueNetworkingTask,
      exec: {
        ...createEnvironment().exec,
        serialize: (value) => ({ value }),
        deserialize: vi.fn(),
      },
    });
    controller.terminate();
    abort('first');
    abort('second');
    expect(controller.state).toBe('aborted');
    expect(controller.serializedAbortReason).toEqual({ value: 'second' });
  });

  it('keeps an omitted abort error distinct from an explicitly supplied undefined', () => {
    const serialize = vi.fn((value: unknown) => ({ value }));
    const { abort } = createControllerFixture({
      queueNetworkingTask, exec: { ...createEnvironment().exec, serialize, deserialize: vi.fn() },
    });

    abort();
    expect(serialize.mock.calls[0]![0]).toMatchObject({ name: 'AbortError' });
    abort(undefined);
    expect(serialize.mock.calls[1]![0]).toBeUndefined();
  });

  it('falls back to AbortError if deserialization throws', () => {
    const { deserialize } = createControllerFixture({
      queueNetworkingTask,
      exec: {
        ...createEnvironment().exec,
        serialize: vi.fn(),
        deserialize: () => { throw new Error('Unavailable serialized type'); },
      },
    });
    const reason = deserialize({});
    expect(reason).toMatchObject({ name: 'AbortError', message: '' });
  });

  it('reports timing to the supplied environment and exposes the retained full record', () => {
    const controller = new FetchController();
    const env = createClientEnvironment();
    const timing = new FetchTimingInfo();
    timing.startTime = 42;
    controller.fullTimingInfo = timing;
    controller.reportTimingSteps = vi.fn();
    controller.nextManualRedirectSteps = vi.fn();

    controller.reportTiming(env);
    controller.processNextManualRedirect();

    expect(controller.reportTimingSteps).toHaveBeenCalledExactlyOnceWith(env);
    expect(controller.nextManualRedirectSteps).toHaveBeenCalledExactlyOnceWith();
    expect(controller.extractFullTimingInfo()).toBe(timing);
  });

  it('requires the steps and full timing info prescribed by the algorithms', () => {
    const controller = new FetchController();
    expect(() => controller.reportTiming(createClientEnvironment())).toThrow('timing steps are not set');
    expect(() => controller.processNextManualRedirect()).toThrow('redirect steps are not set');
    expect(() => controller.extractFullTimingInfo()).toThrow('full timing info is not set');
  });
});

describe('Fetch params and controller state', () => {
  it('retains request/timing references and derives cancellation from the controller', () => {
    const request = createFetchRequest();
    const timing = new FetchTimingInfo();
    const env = createEnvironment();
    const params = new FetchParams(request, timing, env);
    expect(params).toMatchObject({
      processRequestBodyChunkLength: null, processRequestEndOfBody: null,
      processEarlyHintsResponse: null, processResponse: null, processResponseEndOfBody: null,
      processResponseConsumeBody: null, taskDestination: null, crossOriginIsolatedCapability: false,
      preloadedResponseCandidate: null,
    });
    expect(params.request).toBe(request);
    expect(params.timingInfo).toBe(timing);
    expect(params.env).toBe(env);
    expect(params.controller).not.toBe(new FetchParams(request, timing, env).controller);
    expect(params.canceled).toBe(false);
    expect(params.aborted).toBe(false);
    params.controller.terminate();
    expect(params.canceled).toBe(true);
    expect(params.aborted).toBe(false);
    params.controller.state = 'aborted';
    expect(params.aborted).toBe(true);
  });
});

describe('Fetch networking task destinations', () => {
  it('passes a global and its algorithm to HTML without running it inline', () => {
    const global = {};
    const algorithm = vi.fn();
    const queueGlobalTask = vi.fn();
    const env = createEnvironment();
    env.exec.networking.queueGlobalTask = queueGlobalTask;

    env.queueNetworkingTask(algorithm, global);

    expect(queueGlobalTask).toHaveBeenCalledExactlyOnceWith(global, algorithm);
    expect(algorithm).not.toHaveBeenCalled();
  });

  it('uses the parallel destination FIFO without calling the global-task capability', () => {
    const drains: (() => void)[] = [];
    const queue = new ParallelQueue((steps) => drains.push(steps));
    const queueGlobalTask = vi.fn();
    const env = createEnvironment();
    env.exec.networking.queueGlobalTask = queueGlobalTask;
    const order: number[] = [];

    env.queueNetworkingTask(() => {
      order.push(1);
      env.queueNetworkingTask(() => order.push(3), queue);
    }, queue);
    env.queueNetworkingTask(() => order.push(2), queue);
    expect(order).toEqual([]);
    expect(drains).toHaveLength(1);
    drains.shift()!();

    expect(order).toEqual([1, 2, 3]);
    expect(queueGlobalTask).not.toHaveBeenCalled();
  });
});
