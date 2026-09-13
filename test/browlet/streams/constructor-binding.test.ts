import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import {
  createStructuredClone, createWindowRealm, getRelevantRealm, retargetWindowProxy,
} from '../../../src/browlet/bindings';
import { BrowsingContext } from '../../../src/browlet/browsing/browsing-context';
import { WindowImpl } from '../../../src/browlet/browsing/window/window';
import type { WindowProxy } from '../../../src/browlet/browsing/window/window-proxy';
import { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { WindowAgent } from '../../../src/browlet/scripting/agents';
import { setupWindowEnvironmentSettingsObject } from '../../../src/browlet/scripting/environment';

describe('Streams constructor bindings', () => {
  it.each([
    ['ReadableStream', 'ReadableStreamDefaultController', 1],
    ['WritableStream', 'WritableStreamDefaultController', 1],
    ['TransformStream', 'TransformStreamDefaultController', 2],
  ] as const)('%s converts strategies before its callback dictionary', (name, controllerName, strategyCount) => {
    const window = new Browlet({ route: () => '' }).window;
    const order: string[] = [];
    const calls: { receiver: unknown; controller: unknown; }[] = [];
    const source = {
      get start() {
        order.push('get start');
        return function(this: unknown, value: unknown) {
          calls.push({ receiver: this, controller: value });
          order.push('call start');
        };
      },
    };
    const strategies = Array.from({ length: strategyCount }, (_, index) => ({
      get highWaterMark() { order.push(`highWaterMark ${index}`); return 1; },
      get size() { order.push(`size ${index}`); return undefined; },
    }));

    construct(window, name, [source, ...strategies]);

    expect(order).toEqual(strategyCount === 1
      ? ['highWaterMark 0', 'size 0', 'get start', 'call start']
      : ['highWaterMark 0', 'size 0', 'highWaterMark 1', 'size 1', 'get start', 'call start']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.receiver).toBe(source);
    expect(calls[0]?.controller).toBeInstanceOf(Reflect.get(window, controllerName));
  });

  it.each([
    ['ReadableStream', 'ReadableStreamDefaultController'],
    ['WritableStream', 'WritableStreamDefaultController'],
    ['TransformStream', 'TransformStreamDefaultController'],
  ] as const)('%s keeps its controller realm when start belongs to another window', (name, controllerName) => {
    const first = new Browlet({ route: () => '' }).window;
    const second = createRelatedWindow(first);
    let callbackThis: unknown;
    let controller: unknown;
    Reflect.set(second, 'observe', (receiver: unknown, value: unknown) => {
      callbackThis = receiver;
      controller = value;
    });
    const start = getRelevantRealm(second).evaluate(
      '(function(controller) { observe(this, controller); })',
      'foreign-stream-start.js',
    );
    const source = { start };

    construct(first, name, [source]);

    expect(callbackThis).toBe(source);
    expect(controller).toBeInstanceOf(Reflect.get(first, controllerName));
    expect(controller).not.toBeInstanceOf(Reflect.get(second, controllerName));
  });

  it('converts byte sources and preserves synchronous start exceptions', () => {
    const window = new Browlet({ route: () => '' }).window;
    let controller: unknown;
    construct(window, 'ReadableStream', [{
      type: 'bytes', start(value: unknown) { controller = value; },
    }]);
    expect(controller).toBeInstanceOf(Reflect.get(window, 'ReadableByteStreamController'));

    const error = new Error('start failed');
    for (const name of ['ReadableStream', 'WritableStream', 'TransformStream']) {
      expect(() => construct(window, name, [{ start() { throw error; } }])).toThrow(error);
    }
  });

  it('initializes an omitted transformer and rejects author null instead of treating it as internal allocation', () => {
    const window = new Browlet({ route: () => '' }).window;
    const stream = construct(window, 'TransformStream');
    expect(Reflect.get(stream, 'readable')).toBeInstanceOf(Reflect.get(window, 'ReadableStream'));
    expect(Reflect.get(stream, 'writable')).toBeInstanceOf(Reflect.get(window, 'WritableStream'));
    for (const name of ['ReadableStream', 'WritableStream', 'TransformStream']) {
      expect(() => construct(window, name, [null])).toThrow(Reflect.get(window, 'TypeError'));
    }
  });

  it('passes converted streams to reader and writer constructors', () => {
    const window = new Browlet({ route: () => '' }).window;
    const stream = construct(window, 'ReadableStream');
    const bytes = construct(window, 'ReadableStream', [{ type: 'bytes' }]);
    const writable = construct(window, 'WritableStream');

    const reader = construct(window, 'ReadableStreamDefaultReader', [stream]);
    const byobReader = construct(window, 'ReadableStreamBYOBReader', [bytes]);
    const writer = construct(window, 'WritableStreamDefaultWriter', [writable]);

    expect(Reflect.get(stream, 'locked')).toBe(true);
    expect(Reflect.get(bytes, 'locked')).toBe(true);
    expect(Reflect.get(writable, 'locked')).toBe(true);
    for (const value of [reader, byobReader, writer]) {
      expect(Reflect.get(value, 'closed')).toBeInstanceOf(Reflect.get(window, 'Promise'));
    }
  });
});

function construct(global: object, name: string, args: unknown[] = []): object {
  const constructor = Reflect.get(global, name) as new (...args: unknown[]) => object;
  return Reflect.construct(constructor, args);
}

function createRelatedWindow(first: Window): WindowProxy {
  const firstRealm = getRelevantRealm(first);
  const { agent, hostDefined: settings } = firstRealm;
  if (!(agent instanceof WindowAgent) || !settings) {
    throw new Error('Expected an initialized Window realm');
  }
  const window = new WindowImpl(new URL('about:blank'));
  const executionContext = createWindowRealm(agent, window);
  const { realm } = executionContext;
  const proxy = realm.globalThis as WindowProxy;
  const document = new DocumentImpl();
  document.setBrowsingContext(new BrowsingContext(proxy));
  window.setAssociatedDocument(document);
  setupWindowEnvironmentSettingsObject(
    settings.creationURL, executionContext, null, settings.creationURL,
    settings.origin, createStructuredClone(realm),
  );
  retargetWindowProxy(proxy, window);
  return proxy;
}
