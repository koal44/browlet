import { describe, expect, it, vi } from 'vitest';

import { endOfIteration, type AsyncIterator, type InternalPromise } from '../../../../src/infra/index';
import {
  arg, asyncSequence, ctor, defineCallbackFunction, defineCallbackInterface, defineDictionary, defineInterface, dictMember,
  idlType, impl, implementationType, onError, op, promise, reference, sequence,
} from '../../../../src/web-idl/core/index';
import { BindingWorld } from '../../../../src/web-idl/binding/world';

import { TestRealm } from '../../../support/web-idl-realm';

describe('Promise and async sequence implementation conversion', () => {
  it.each(['rethrow', 'report'] as const)('preserves the %s policy for callbacks yielded by async sequences', async (behavior) => {
    class RunnerImpl {
      run(callbacks: AsyncIterator<() => void>) {
        return callbacks.next().then((callback) => {
          if (callback !== endOfIteration) callback();
        }, undefined, idlType.undefined);
      }
    }
    const handler = defineCallbackFunction({ name: 'Handler', returns: idlType.undefined, arguments: [] });
    const runner = defineInterface({
      name: 'Runner', exposed: '*', implementation: impl(RunnerImpl),
      members: [ctor(), op('run', promise(idlType.undefined), [
        arg('callbacks', asyncSequence(reference(handler.name)), onError(behavior)),
      ])],
    });
    const realm = new TestRealm();
    new BindingWorld([handler, runner]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Runner = Reflect.get(realm.global, 'Runner') as new() => { run(callbacks: (() => void)[]): Promise<void>; };
    const failure = new Error('callback failed');
    const callback = vi.fn(() => { throw failure; });
    const report = vi.spyOn(realm, 'reportException').mockImplementation(() => {});
    const result = new Runner().run([callback]);

    if (behavior === 'report') await expect(result).resolves.toBeUndefined();
    else await expect(result).rejects.toBe(failure);
    expect(callback).toHaveBeenCalledOnce();
    expect(report.mock.calls).toEqual(behavior === 'report' ? [[failure]] : []);
  });

  it.each(['rethrow', 'report'] as const)('preserves the %s policy through Promise and sequence results', async (behavior) => {
    class RunnerImpl {
      run(callbacks: InternalPromise<(() => void)[]>) {
        return callbacks.then((callbacks) => { callbacks[0]!(); }, undefined, idlType.undefined);
      }
    }
    const handler = defineCallbackFunction({ name: 'Handler', returns: idlType.undefined, arguments: [] });
    const runner = defineInterface({
      name: 'Runner', exposed: '*', implementation: impl(RunnerImpl),
      members: [ctor(), op('run', promise(idlType.undefined), [
        arg('callbacks', promise(sequence(reference(handler.name))), onError(behavior)),
      ])],
    });
    const realm = new TestRealm();
    new BindingWorld([handler, runner]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Runner = Reflect.get(realm.global, 'Runner') as new() => { run(callbacks: Promise<(() => void)[]>): Promise<void>; };
    const failure = new Error('callback failed');
    const callback = vi.fn(() => { throw failure; });
    const report = vi.spyOn(realm, 'reportException').mockImplementation(() => {});
    const result = new Runner().run(Promise.resolve([callback]));

    if (behavior === 'report') await expect(result).resolves.toBeUndefined();
    else await expect(result).rejects.toBe(failure);
    expect(callback).toHaveBeenCalledOnce();
    expect(report.mock.calls).toEqual(behavior === 'report' ? [[failure]] : []);
  });

  it.each(['general', 'prepared'] as const)('keeps the Promise fulfillment realm in %s conversion', async (mode) => {
    const world = new BindingWorld([]);
    const sourceRealm = new TestRealm();
    const observerRealm = new TestRealm();
    world.register(sourceRealm, (ctx) => ({ realm: ctx.realm }));
    const context = world.register(observerRealm, (ctx) => ({ realm: ctx.realm }));
    const sourceBinding = world.getRealmBinding(sourceRealm)!;
    const observerBinding = world.getRealmBinding(observerRealm)!;
    const type = sourceBinding.assembly.getIDLType(promise(sequence(idlType.ByteString)));
    const coerce = vi.fn(() => '\u0100');
    const incoming = [{ toString: coerce }];
    const value = sourceBinding.getConverter(type).jsToIDL(Promise.resolve(incoming));
    const impl = observerBinding.implementationConverter;
    const result = mode === 'prepared' ? impl.createConverter(type, {})(value, context)
      : impl.idlToImpl(value, type, {}, context);
    await expect(value.promise).resolves.toBe(incoming);
    expect(coerce).not.toHaveBeenCalled();
    const observed = Promise.withResolvers<string[]>();
    result.observe(observed.resolve, observed.reject);

    await expect(observed.promise).rejects.toBeInstanceOf(sourceRealm.intrinsics.typeError);
    expect(coerce).toHaveBeenCalledOnce();
    expect(result.backing).toBe(value.promise);
    expect(result.backing).toBeInstanceOf(sourceRealm.intrinsics.promise.constructor);
  });

  it('allows repeated observations of one async iteration result containing a callback', async () => {
    type Entry = { handler: () => void; };
    const handler = defineCallbackFunction({ name: 'Handler', returns: idlType.undefined, arguments: [] });
    const entry = defineDictionary({
      name: 'Entry', members: [dictMember('handler', reference(handler.name), onError('rethrow'))],
    });
    const realm = new TestRealm();
    const context = new BindingWorld([handler, entry]).register(realm, (ctx) => ({ realm: ctx.realm }));
    const callback = vi.fn();
    const iterator = context.jsToImpl([{ handler: callback }], asyncSequence(
      implementationType<Entry>(reference(entry.name)),
    ));
    const next = iterator.next();
    const first = Promise.withResolvers<Entry | typeof endOfIteration>();
    next.observe(first.resolve, first.reject);
    const value = await first.promise;
    expect(value).not.toBe(endOfIteration);
    if (value === endOfIteration) throw new Error('Expected an entry');
    const bound = value.handler;
    const second = Promise.withResolvers<unknown>();
    next.observe(second.resolve, second.reject);

    await expect(second.promise).resolves.toBe(value);
    expect(value.handler).toBe(bound);
    value.handler();
    expect(callback).toHaveBeenCalledOnce();
  });

  it('retains an async iteration conversion failure for later observers', async () => {
    const failure = new Error('implementation conversion failed');
    const convert = vi.fn(() => { throw failure; });
    const handler = defineCallbackInterface({
      name: 'Handler', members: [op('run', idlType.undefined)], toImpl: convert,
    });
    const realm = new TestRealm();
    const context = new BindingWorld([handler]).register(realm, (ctx) => ({ realm: ctx.realm }));
    const iterator = context.jsToImpl([{}], asyncSequence(reference(handler.name)));
    const next = iterator.next();
    const first = Promise.withResolvers<unknown>();
    next.observe(first.resolve, first.reject);
    await expect(first.promise).rejects.toBe(failure);
    const second = Promise.withResolvers<unknown>();
    next.observe(second.resolve, second.reject);
    await expect(second.promise).rejects.toBe(failure);
    expect(convert).toHaveBeenCalledOnce();
  });
});
