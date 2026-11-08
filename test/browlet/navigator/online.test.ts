import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import type { DedicatedWorkerGlobalScope, SharedWorkerGlobalScope } from '../../../src/browlet/platform';
import { DedicatedWorkerAgent, SharedWorkerAgent } from '../../../src/browlet/scripting/index';
import { networkingTaskSource } from '../../../src/browlet/scripting/tasks';
import { isOffline } from '../../../src/fetch/index';
import { parseURL } from '../../../src/url/index';
import { createManualUserAgent } from '../../support/browlet-agent';
import { useFixture } from '../../support/fixture';

describe('HTML NavigatorOnLine', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(() => {
    const userAgent = createManualUserAgent();
    const window = TopLevelTraversable.create(userAgent, null, '').activeWindow!;
    const env = window.env;
    return { userAgent, window, env, platform: env.realm.windowProxy.platform, loop: env.responsibleEventLoop };
  });

  it('exposes a readonly prototype getter with checked receivers and no mixin constructor', () => {
    const { platform, env, loop } = prepared();
    expect(platform.navigator.onLine).toBe(true);
    expect(Reflect.has(platform, 'NavigatorOnLine')).toBe(false);
    const descriptor = Object.getOwnPropertyDescriptor(platform.Navigator.prototype, 'onLine')!;
    expect(descriptor).toMatchObject({ enumerable: true, configurable: true, set: undefined });
    expect(Object.hasOwn(platform.navigator, 'onLine')).toBe(false);
    expect(Reflect.set(platform.navigator, 'onLine', false)).toBe(false);
    expect(() => { descriptor.get!.call({}); }).toThrow(env.realm.TypeError);
    expect(() => { descriptor.get!.call(null); }).toThrow(env.realm.TypeError);
    expect(loop.runTaskTurn()).toBe(false);
  });

  it('queries the same live state as Fetch, using its own settings and offline short circuit', () => {
    const { userAgent, env, platform } = prepared();
    const emulation = vi.spyOn(userAgent, 'webDriverBiDiNetworkIsOffline');
    for (const [assumedOffline, emulatedOffline, online] of [
      [false, false, true], [false, true, false], [true, false, false], [true, true, false],
    ] as const) {
      userAgent.assumeNoInternetConnectivity = assumedOffline;
      emulation.mockReset().mockReturnValue(emulatedOffline);
      expect(platform.navigator.onLine).toBe(online);
      expect(emulation).toHaveBeenCalledTimes(assumedOffline ? 0 : 1);
      if (!assumedOffline) expect(emulation).toHaveBeenCalledWith(env);
      expect(platform.navigator.onLine).toBe(!isOffline(env));
    }
  });

  it('updates an unread getter immediately and queues trusted global events on the networking source', () => {
    const { userAgent, window, platform, loop } = prepared();
    const events: unknown[] = [];
    platform.onoffline = platform.ononline = (event) => {
      events.push({
        type: event.type, online: platform.navigator.onLine, trusted: event.isTrusted,
        bubbles: event.bubbles, cancelable: event.cancelable, composed: event.composed,
        target: event.target === platform, currentTarget: event.currentTarget === platform,
        source: loop.currentlyRunningTask?.source,
      });
    };
    for (const offline of [true, false]) {
      userAgent.setOffline(offline, [window.navigator]);
      expect(platform.navigator.onLine).toBe(!offline);
      const task = [...loop.getTaskQueue(networkingTaskSource)][0]!;
      expect(task.document).toBe(window.document);
      expect(events).toHaveLength(offline ? 0 : 1);
      expect(loop.runTaskTurn()).toBe(true);
    }
    expect(events).toEqual(['offline', 'online'].map((type) => ({
      type, online: type === 'online', trusted: true, bubbles: false, cancelable: false,
      composed: false, target: true, currentTarget: true, source: networkingTaskSource,
    })));
  });

  it('does not queue duplicate transitions for unchanged state or repeated recipients', () => {
    const { userAgent, window, platform, loop } = prepared();
    const listener = vi.fn();
    platform.onoffline = platform.ononline = listener;
    userAgent.setOffline(false, [window.navigator]);
    expect(loop.runTaskTurn()).toBe(false);
    userAgent.setOffline(true, [window.navigator, window.navigator]);
    userAgent.setOffline(true, [window.navigator]);
    expect(loop.runTaskTurn()).toBe(true);
    expect(loop.runTaskTurn()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('retains each transition in order when connectivity changes again before delivery', () => {
    const { userAgent, window, platform, loop } = prepared();
    const events: unknown[] = [];
    platform.onoffline = platform.ononline = (event) => { events.push([event.type, platform.navigator.onLine]); };
    userAgent.setOffline(true, [window.navigator]);
    userAgent.setOffline(false, [window.navigator]);
    expect(platform.navigator.onLine).toBe(true);
    expect(events).toEqual([]);
    loop.runTaskTurn();
    expect(events).toEqual([['offline', true]]);
    loop.runTaskTurn();
    expect(events).toEqual([['offline', true], ['online', true]]);
  });

  it('queues a listener-triggered transition for a later task while updating the getter immediately', () => {
    const { userAgent, window, platform, loop } = prepared();
    const events: string[] = [];
    platform.onoffline = (event) => {
      events.push(event.type);
      userAgent.setOffline(false, [window.navigator]);
      expect(platform.navigator.onLine).toBe(true);
    };
    platform.ononline = (event) => { events.push(event.type); };
    userAgent.setOffline(true, [window.navigator]);
    loop.runTaskTurn();
    expect(events).toEqual(['offline']);
    loop.runTaskTurn();
    expect(events).toEqual(['offline', 'online']);
  });

  it('accepts environment emulation transitions through the same notification entry', () => {
    const { userAgent, window, platform, loop } = prepared();
    const emulation = vi.spyOn(userAgent, 'webDriverBiDiNetworkIsOffline').mockReturnValue(false);
    const events: string[] = [];
    platform.onoffline = platform.ononline = (event) => { events.push(event.type); };
    for (const offline of [true, true, false]) {
      const wasOnline = window.navigator.onLine;
      emulation.mockReturnValue(offline);
      window.navigator.queueOnlineStateChange(wasOnline);
      expect(platform.navigator.onLine).toBe(!offline);
    }
    expect(events).toEqual([]);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(loop.runTaskTurn()).toBe(false);
    expect(events).toEqual(['offline', 'online']);
  });

  it('does not notify when emulation keeps the effective state offline', () => {
    const { userAgent, window, platform, loop } = prepared();
    vi.spyOn(userAgent, 'webDriverBiDiNetworkIsOffline').mockReturnValue(true);
    const listener = vi.fn();
    platform.onoffline = platform.ononline = listener;
    userAgent.setOffline(true, [window.navigator]);
    userAgent.setOffline(false, [window.navigator]);
    expect(platform.navigator.onLine).toBe(false);
    expect(loop.runTaskTurn()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('discards an old Document notification without reverting the live getter', () => {
    const { userAgent, window, platform, loop } = prepared();
    const listener = vi.fn();
    platform.onoffline = listener;
    userAgent.setOffline(true, [window.navigator]);
    loop.removeTasksForDocument(window.document);
    expect(loop.runTaskTurn()).toBe(false);
    expect(platform.navigator.onLine).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('holds an inactive Document notification until its task becomes runnable', () => {
    const { userAgent, window, platform, loop } = prepared();
    const active = vi.spyOn(window.document, 'isFullyActive').mockReturnValue(false);
    const listener = vi.fn();
    platform.onoffline = listener;
    userAgent.setOffline(true, [window.navigator]);
    expect(platform.navigator.onLine).toBe(false);
    expect(loop.runTaskTurn()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    active.mockRestore();
    expect(loop.runTaskTurn()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('delivers through the existing body-to-Window event handler forwarding', () => {
    const { userAgent, window, platform, loop } = prepared();
    const body = platform.document.createElement('body');
    if (!(body instanceof platform.HTMLBodyElement)) throw new Error('Expected an HTML body element');
    const listener = vi.fn();
    body.onoffline = listener;
    expect(platform.onoffline).toBe(listener);
    userAgent.setOffline(true, [window.navigator]);
    loop.runTaskTurn();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ target: platform }));
  });
});

describe('Navigator connectivity ownership', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(() => {
    const userAgent = createManualUserAgent();
    const first = TopLevelTraversable.create(userAgent, null, '').activeWindow!;
    const second = TopLevelTraversable.create(userAgent, null, '').activeWindow!;
    return { userAgent, first, second };
  });

  it('uses the receiver settings for borrowed getters and the method realm for invalid receivers', () => {
    const { userAgent, first, second } = prepared();
    vi.spyOn(userAgent, 'webDriverBiDiNetworkIsOffline').mockImplementation((env) => env === first.env);
    const one = first.env.realm.windowProxy.platform;
    const two = second.env.realm.windowProxy.platform;
    const descriptor = Object.getOwnPropertyDescriptor(two.Navigator.prototype, 'onLine')!;
    expect(two.navigator.onLine).toBe(true);
    expect(descriptor.get!.call(one.navigator)).toBe(false);
    expect(() => { descriptor.get!.call({}); }).toThrow(second.env.realm.TypeError);
  });

  it('notifies only changed recipients on their own loops, including removal of an override', () => {
    const { userAgent, first, second } = prepared();
    const emulation = vi.spyOn(userAgent, 'webDriverBiDiNetworkIsOffline').mockImplementation((env) => env === first.env);
    const one = vi.fn();
    const two = vi.fn();
    first.env.realm.windowProxy.platform.onoffline = first.env.realm.windowProxy.platform.ononline = one;
    second.env.realm.windowProxy.platform.onoffline = two;
    userAgent.setOffline(true, [first.navigator, second.navigator]);
    expect(first.env.responsibleEventLoop.runTaskTurn()).toBe(false);
    expect(second.env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(one).not.toHaveBeenCalled();
    expect(two).toHaveBeenCalledTimes(1);
    const wasOnline = first.navigator.onLine;
    emulation.mockReturnValue(false);
    first.navigator.queueOnlineStateChange(wasOnline);
    expect(first.env.responsibleEventLoop.runTaskTurn()).toBe(false);
    userAgent.setOffline(false, [first.navigator, second.navigator]);
    expect(first.env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(one).toHaveBeenCalledTimes(1);
  });
});

describe.each([false, true])('WorkerNavigator connectivity, shared: %s', (shared) => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture((fixture) => {
    const userAgent = createManualUserAgent();
    const window = TopLevelTraversable.create(userAgent, null, '').activeWindow!;
    const agent = userAgent.obtainDedicatedOrSharedWorkerAgent(window.env, shared);
    if (!(agent instanceof DedicatedWorkerAgent || agent instanceof SharedWorkerAgent)) {
      throw new Error('Expected a dedicated or shared worker agent');
    }
    const env = createWorkerEnvironment({
      agent, outsideEnv: window.env, url: parseURL('https://navigator.test/worker.js').url!, unsafeWorkerCreationTime: 1234,
      type: 'module', name: 'online', credentials: 'same-origin', extendedLifetime: shared,
    });
    const scope = env.global as unknown as DedicatedWorkerGlobalScope | SharedWorkerGlobalScope;
    fixture.onCleanup(() => { agent.globalScope!.close(); });
    return { userAgent, window, env, scope, navigator: agent.globalScope!.navigator, loop: env.responsibleEventLoop };
  });

  it('updates immediately and delivers both trusted worker events on its networking task source', () => {
    const { userAgent, window, navigator, scope, loop } = prepared();
    expect(scope.navigator.onLine).toBe(true);
    expect(Reflect.set(scope.navigator, 'onLine', false)).toBe(false);
    expect(Reflect.has(scope, 'NavigatorOnLine')).toBe(false);
    const events: unknown[] = [];
    scope.onoffline = scope.ononline = (event) => {
      events.push({
        type: event.type, target: event.target === scope, trusted: event.isTrusted,
        bubbles: event.bubbles, cancelable: event.cancelable, composed: event.composed,
        source: loop.currentlyRunningTask?.source,
      });
    };
    const windowListener = vi.fn();
    window.env.realm.windowProxy.platform.onoffline = windowListener;
    for (const offline of [true, false]) {
      userAgent.setOffline(offline, [window.navigator, navigator]);
      expect(scope.navigator.onLine).toBe(!offline);
      expect(events).toHaveLength(offline ? 0 : 1);
      expect(loop.runTaskTurn()).toBe(true);
    }
    expect(events).toEqual(['offline', 'online'].map((type) => ({
      type, target: true, trusted: true, bubbles: false, cancelable: false, composed: false, source: networkingTaskSource,
    })));
    expect(windowListener).not.toHaveBeenCalled();
    expect(window.env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(windowListener).toHaveBeenCalledTimes(1);
  });

  it('uses the worker settings for Fetch/BiDi state independently of its creator', () => {
    const { userAgent, window, env, navigator, scope, loop } = prepared();
    const wasOnline = navigator.onLine;
    vi.spyOn(userAgent, 'webDriverBiDiNetworkIsOffline').mockImplementation((queriedEnv) => queriedEnv === env);
    const listener = vi.fn();
    scope.onoffline = listener;
    navigator.queueOnlineStateChange(wasOnline);
    expect(scope.navigator.onLine).toBe(false);
    expect(scope.navigator.onLine).toBe(!isOffline(env));
    expect(window.navigator.onLine).toBe(true);
    expect(loop.runTaskTurn()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('discards pending and future notifications when the worker closes', () => {
    const { userAgent, navigator, scope, loop } = prepared();
    const listener = vi.fn();
    scope.onoffline = scope.ononline = listener;
    userAgent.setOffline(true, [navigator]);
    scope.close();
    userAgent.setOffline(false, [navigator]);
    expect(loop.runTaskTurn()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });
});
