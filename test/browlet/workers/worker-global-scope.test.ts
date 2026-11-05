import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { SandboxEnvironment } from '../../../src/browlet/environment/index';
import { browletBindingWorld, createBrowletEnvironmentInit } from '../../../src/browlet/integration/web-idl/index';
import { BrowletRealm, EventLoop, SandboxAgent } from '../../../src/browlet/scripting/index';
import { UserAgent } from '../../../src/browlet/user-agent';
import { WorkerGlobalImpl, type WorkerType } from '../../../src/browlet/workers/index';
import type { Event, WorkerGlobalScope } from '../../../src/browlet/platform';
import type { JSFunction } from '../../../src/js-engine/index';
import { parseURL } from '../../../src/url/index';

describe('WorkerGlobalScope common foundation (HTML §10.2.1.1)', () => {
  it('retains creation parameters and independent initially empty global state', () => {
    const first = createScope();
    const second = createScope('module', 'other');
    const unstarted = new TestWorker('classic', 'not started', first.env);
    expect(unstarted.url).toBeNull();
    expect(second.implementation.type).toBe('module');
    expect(second.implementation.name).toBe('other');
    expect(first.implementation.crossOriginIsolatedCapability).toBe(false);
    expect(first.implementation.ownerSet.size).toBe(0);
    expect(first.implementation.moduleMap.entries).toEqual([]);
    first.implementation.ownerSet.add(second.implementation);
    first.implementation.moduleMap.set(first.implementation.url!, 'javascript-or-wasm', null);
    first.implementation.policyContainer.referrerPolicy = 'no-referrer';
    expect(second.implementation.ownerSet.size).toBe(0);
    expect(second.implementation.moduleMap.entries).toEqual([]);
    expect(second.implementation.policyContainer.referrerPolicy).not.toBe('no-referrer');
  });

  it('projects self and stable worker-specific location and navigator identities', () => {
    const { scope, interfaces, realm } = createScope();
    expect(scope.self).toBe(scope);
    expect(scope.location).toBe(scope.location);
    expect(scope.navigator).toBe(scope.navigator);
    for (const [name, value] of [
      ['WorkerGlobalScope', scope], ['WorkerLocation', scope.location], ['WorkerNavigator', scope.navigator],
    ] as const) {
      const constructor = interfaces.get(name)! as JSFunction;
      expect(value).toBeInstanceOf(constructor);
      expect(() => { Reflect.construct(constructor, []); }).toThrow(realm.TypeError);
    }
    expect(scope).toBeInstanceOf(interfaces.get('EventTarget')! as JSFunction);
    expect(Reflect.set(scope, 'self', {})).toBe(false);
    expect(Reflect.set(scope, 'location', {})).toBe(false);
    expect(Reflect.set(scope, 'navigator', {})).toBe(false);
    for (const name of ['type', 'name', 'url', 'ownerSet', 'moduleMap', 'policyContainer', 'env']) {
      expect(Reflect.has(scope, name)).toBe(false);
    }
  });

  it('keeps worker-only interfaces out of Window exposure', () => {
    const browser = new Browlet({ route: () => '' });
    for (const name of ['WorkerGlobalScope', 'DedicatedWorkerGlobalScope', 'SharedWorkerGlobalScope', 'WorkerLocation', 'WorkerNavigator']) {
      expect(Reflect.has(browser.window, name)).toBe(false);
    }
  });

  it('unwraps a foreign receiver and preserves that receiver\'s public self identity', () => {
    const first = createScope();
    const second = createScope();
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(first.scope), 'self')!;
    const getter = Reflect.get(descriptor, 'get') as JSFunction;
    expect(Reflect.apply(getter, second.scope, [])).toBe(second.scope);
    expect(() => { Reflect.apply(getter, {}, []); }).toThrow(first.realm.TypeError);
  });

  it.each(['languagechange', 'offline', 'online', 'rejectionhandled', 'unhandledrejection'])(
    'dispatches %s through the ordinary handler binding with platform identities', (type) => {
      const { scope, makeEvent } = createScope();
      const trace: unknown[] = [];
      const event = makeEvent('Event', type, { cancelable: true });
      const callback = function(this: unknown, received: Event) {
        trace.push([this, received]);
        return false;
      };
      expect(Reflect.get(scope, `on${type}`)).toBeNull();
      Reflect.set(scope, `on${type}`, callback);
      expect(Reflect.get(scope, `on${type}`)).toBe(callback);
      expect(scope.dispatchEvent(event)).toBe(false);
      expect(trace).toEqual([[scope, event]]);
      Reflect.set(scope, `on${type}`, null);
      scope.dispatchEvent(makeEvent('Event', type));
      expect(trace).toHaveLength(1);
    },
  );

  it('uses the five-argument onerror callback and cancels only for true', () => {
    const { scope, makeEvent } = createScope();
    const error = {};
    const trace: unknown[][] = [];
    let result = true;
    scope.onerror = function(this: unknown, ...args: unknown[]) {
      trace.push([this, ...args]);
      return result;
    };
    const options = { message: 'boom', filename: 'https://worker.test/main.js', lineno: 3, colno: 7, error, cancelable: true };
    expect(scope.dispatchEvent(makeEvent('ErrorEvent', 'error', options))).toBe(false);
    expect(trace).toEqual([[scope, 'boom', options.filename, 3, 7, error]]);
    result = false;
    expect(scope.dispatchEvent(makeEvent('ErrorEvent', 'error', options))).toBe(true);
  });

  it('keeps ordinary error events on the one-argument, false-cancels path', () => {
    const { scope, makeEvent } = createScope();
    const event = makeEvent('Event', 'error', { cancelable: true });
    const trace: unknown[][] = [];
    scope.onerror = (...args: unknown[]) => { trace.push(args); return false; };
    expect(scope.dispatchEvent(event)).toBe(false);
    expect(trace).toEqual([[event]]);
  });

  it('keeps handler activation order when replacing and clearing callbacks', () => {
    const { scope, makeEvent } = createScope();
    const trace: string[] = [];
    scope.addEventListener('online', () => { trace.push('before'); });
    scope.ononline = () => { trace.push('old'); };
    scope.addEventListener('online', () => { trace.push('after'); });
    scope.ononline = () => { trace.push('new'); };
    scope.dispatchEvent(makeEvent('Event', 'online'));
    expect(trace).toEqual(['before', 'new', 'after']);
    scope.ononline = null;
    scope.ononline = () => { trace.push('last'); };
    trace.length = 0;
    scope.dispatchEvent(makeEvent('Event', 'online'));
    expect(trace).toEqual(['before', 'after', 'last']);
  });
});

describe('WorkerLocation dependency (HTML §10.3.3)', () => {
  it.each([
    ['https://user:pass@worker.test:8443/scripts/main.js?mode=1#part',
      ['https://user:pass@worker.test:8443/scripts/main.js?mode=1#part', 'https://worker.test:8443', 'https:',
        'worker.test:8443', 'worker.test', '8443', '/scripts/main.js', '?mode=1', '#part']],
    ['https://[::1]:443/main.js?#', ['https://[::1]/main.js?#', 'https://[::1]', 'https:', '[::1]', '[::1]', '', '/main.js', '', '']],
    ['data:text/javascript,1', ['data:text/javascript,1', 'null', 'data:', '', '', '', 'text/javascript,1', '', '']],
  ])('serializes the worker script URL %s', (url, expected) => {
    const { scope, implementation } = createScope();
    const location = scope.location;
    implementation.url = parseURL(url).url!;
    expect(['href', 'origin', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash']
      .map((name) => Reflect.get(location, name) as unknown)).toEqual(expected);
    expect(String(location)).toBe(expected[0]);
  });

  it('exposes read-only URL attributes without Window navigation operations', () => {
    const { scope } = createScope();
    for (const name of ['href', 'origin', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash']) {
      expect(Reflect.set(scope.location, name, 'changed')).toBe(false);
    }
    for (const name of ['assign', 'replace', 'reload', 'ancestorOrigins', 'username', 'password']) {
      expect(Reflect.has(scope.location, name)).toBe(false);
    }
  });
});

class TestWorker extends WorkerGlobalImpl {}

/** Real Binding and realm facilities, without pretending this fixture starts an HTML worker. */
function createScope(type: WorkerType = 'classic', name = 'test worker') {
  const agent = new SandboxAgent(new EventLoop({ requestTurn() {} }));
  const realm = new BrowletRealm({ agent, globalNames: ['Worker'] });
  const context = browletBindingWorld.register(realm, (binding) =>
    new SandboxEnvironment(realm, createBrowletEnvironmentInit(binding), new UserAgent()),
  );
  const env = context.getEnvironment();
  const implementation = new TestWorker(type, name, env);
  implementation.url = parseURL('https://worker.test/main.js').url!;
  const scope = context.project(WorkerGlobalImpl, implementation)! as WorkerGlobalScope;
  const interfaces = browletBindingWorld.getRealmBinding(realm)!.getExposedGlobalProperties();
  const makeEvent = (name: string, type: string, init: object = {}): Event =>
    Reflect.construct(interfaces.get(name)! as JSFunction, [type, init]) as Event;
  return { context, env, realm, implementation, scope, interfaces, makeEvent };
}
