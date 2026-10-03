import { describe, expect, it, vi } from 'vitest';

import {
  arg, cbDict, ctor, defineCallbackFunction, defineDictionary, defineInterface, dictMember,
  idlType, impl, integer, onError, op, reference, sequence, union,
} from '../../src/web-idl/core/index';
import { BindingWorld } from '../../src/web-idl/binding/world';
import { TestRealm } from './test-realm';

describe('Dictionary and callback implementation conversion', () => {
  it.each(['rethrow', 'report'] as const)('preserves the %s fallback policy through cbDict', (behavior) => {
    type Options = { handler: () => void; };
    class RunnerImpl {
      run(options: Options) { options.handler(); }
      runOther(options: Options) { options.handler(); }
    }
    const otherBehavior = behavior === 'report' ? 'rethrow' : 'report';
    const handler = defineCallbackFunction({ name: 'Handler', arguments: [], returns: idlType.undefined });
    const options = defineDictionary({ name: 'Options', members: [dictMember('handler', reference(handler.name))] });
    const runner = defineInterface({
      name: 'Runner', exposed: '*', implementation: impl(RunnerImpl),
      members: [
        ctor(),
        op('run', idlType.undefined, [
          arg('options', idlType.object, { ...cbDict(options.name), ...onError(behavior) }),
        ]),
        op('runOther', idlType.undefined, [
          arg('options', idlType.object, { ...cbDict(options.name), ...onError(otherBehavior) }),
        ]),
      ],
    });
    const realm = new TestRealm();
    new BindingWorld([handler, options, runner]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Runner = Reflect.get(realm.global, 'Runner') as new() => {
      run(options: Options): void; runOther(options: Options): void;
    };
    const failure = new Error('author callback failed');
    let calls = 0;
    const input = { handler(this: unknown) { calls++; expect(this).toBe(input); throw failure; } };
    const report = vi.spyOn(realm, 'reportException').mockImplementation(() => {});

    const instance = new Runner();
    if (behavior === 'rethrow') expect(() => instance.run(input)).toThrow(failure);
    else expect(() => instance.run(input)).not.toThrow();
    expect(calls).toBe(1);
    expect(report.mock.calls).toEqual(behavior === 'report' ? [[failure]] : []);

    // Both policies share one assembled dictionary, but must not share their exception choice.
    report.mockClear();
    if (otherBehavior === 'rethrow') expect(() => instance.runOther(input)).toThrow(failure);
    else expect(() => instance.runOther(input)).not.toThrow();
    expect(calls).toBe(2);
    expect(report.mock.calls).toEqual(otherBehavior === 'report' ? [[failure]] : []);
  });

  it('keeps nested callback receivers independent of the outer callback dictionary', () => {
    type Options = { handler: () => unknown; child: { handler: () => unknown; }; };
    const receiver = {};
    class RunnerImpl {
      run(options: Options) {
        return [options.handler.call(receiver), options.child.handler.call(receiver)];
      }
    }
    const handler = defineCallbackFunction({ name: 'Handler', arguments: [], returns: idlType.any });
    const child = defineDictionary({
      name: 'Child', members: [dictMember('handler', reference(handler.name), onError('rethrow'))],
    });
    const options = defineDictionary({
      name: 'Options', members: [
        dictMember('handler', reference(handler.name), onError('rethrow')),
        dictMember('child', reference(child.name)),
      ],
    });
    const runner = defineInterface({
      name: 'Runner', exposed: '*', implementation: impl(RunnerImpl),
      members: [ctor(), op('run', sequence(idlType.any), [arg('options', idlType.object, cbDict(options.name))])],
    });
    const realm = new TestRealm();
    new BindingWorld([handler, child, options, runner]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Runner = Reflect.get(realm.global, 'Runner') as new() => { run(options: Options): unknown[]; };
    const callback = function(this: unknown) { return this; };
    const first = { handler: callback, child: { handler: callback } };
    const second = { handler: callback, child: { handler: callback } };
    const instance = new Runner();
    const firstResult = instance.run(first);
    const secondResult = instance.run(second);

    expect(firstResult[0]).toBe(first);
    expect(secondResult[0]).toBe(second);
    expect(firstResult[1]).toBe(receiver);
    expect(secondResult[1]).toBe(receiver);
  });

  it.each(['dictionary', 'union'] as const)('round-trips callback %s results with fresh nested defaults', (kind) => {
    type Payload = { count: number; children: Payload[]; values: number[]; };
    const received: Payload[] = [];
    class RelayImpl {
      run(callback: (value: Payload) => Payload, value: Payload) {
        const result = callback(value);
        received.push(result);
        result.values.push(9);
        return result;
      }
    }
    const payload = defineDictionary({
      name: 'Payload', members: [
        dictMember('count', idlType.long, { default: integer(2) }),
        dictMember('children', sequence(reference('Payload')), { default: { kind: 'empty-sequence' } }),
        dictMember('values', sequence(idlType.long), { default: { kind: 'empty-sequence' } }),
      ],
    });
    const type = kind === 'dictionary' ? reference(payload.name) : union(reference(payload.name), idlType.DOMString);
    const callback = defineCallbackFunction({ name: 'Reply', returns: type, arguments: [arg('value', reference(payload.name))] });
    const relay = defineInterface({
      name: 'Relay', exposed: '*', implementation: impl(RelayImpl),
      members: [ctor(), op('run', type, [
        arg('callback', reference(callback.name), onError('rethrow')),
        arg('value', reference(payload.name), { optional: true, default: { kind: 'empty-dictionary' } }),
      ])],
    });
    const realm = new TestRealm();
    const callbackRealm = new TestRealm();
    new BindingWorld([payload, callback, relay]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Relay = Reflect.get(realm.global, 'Relay') as new() => { run(callback: unknown): Payload; };
    let reads = 0;
    let coercions = 0;
    const source = Object.freeze({
      get count() { reads++; return { valueOf() { coercions++; return 4; } }; },
      children: Object.freeze([Object.freeze({})]),
    });
    Reflect.set(callbackRealm.global, 'source', source);
    const reply = callbackRealm.evaluate(`(value) => {
      if (Object.getPrototypeOf(value) !== Object.prototype || !(value.values instanceof Array)) {
        throw new Error('Callback argument was allocated in the wrong realm');
      }
      if (value.values.length !== 0) throw new Error('Default was shared');
      value.values.push(7);
      return source;
    }`, 'dictionary-callback.js');
    const instance = new Relay();
    const first = instance.run(reply);
    const second = instance.run(reply);

    expect(first).toEqual({ count: 4, children: [{ count: 2, children: [], values: [] }], values: [9] });
    expect(second).toEqual(first);
    expect(first).not.toBe(second);
    expect(received[0]!.values).not.toBe(received[1]!.values);
    expect(received[0]!.children[0]).not.toBe(received[1]!.children[0]);
    expect(Object.getPrototypeOf(first)).toBe(realm.intrinsics.objectPrototype);
    expect(first.values).toBeInstanceOf(realm.intrinsics.array);
    expect(reads).toBe(2);
    expect(coercions).toBe(2);
  });
});
