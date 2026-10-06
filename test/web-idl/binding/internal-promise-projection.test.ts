import { describe, expect, it } from 'vitest';

import { internalType, type InternalPromise, type InternalPromiseWithResolvers } from '../../../src/infra/promises';
import { TypeError as TypeErrorRequest } from '../../../src/infra/exceptions';
import type { JSEnvironment } from '../../../src/js-engine/index';
import { BindingWorld } from '../../../src/web-idl/binding/world';
import {
  atArg, ctor, defineInterface, idlType, impl, implementationType, op, promise, reference, roAttr,
} from '../../../src/web-idl/index';

import { createEnvironment, type TestEnvironment } from '../../js-engine/execution-fixture';
import { TestRealm } from '../../support/web-idl-realm';

describe('InternalPromise result projection', () => {
  it('resolves the platform value immediately, before the promise is first returned', async () => {
    const { binding, implementation, owner } = createFixture();
    const child = new ResultChildImpl();
    const platform = binding.project(ResultChildImpl, child);
    let reads = 0;
    Object.defineProperty(platform, 'then', { get() { reads++; return undefined; } });
    implementation.pending.resolve(child);
    expect(reads).toBe(1);
    const result = Reflect.get(owner, 'result') as Promise<unknown>;
    await expect(result).resolves.toBe(platform);
  });

  it.each(['adopt', 'throw'] as const)('shares the native %s outcome with implementation reactions', async (mode) => {
    const { binding, implementation, owner } = createFixture();
    const child = new ResultChildImpl();
    const replacement = new ResultChildImpl(19);
    const platform = binding.project(ResultChildImpl, child);
    const adopted = binding.project(ResultChildImpl, replacement);
    const failure = new Error('then getter failed');
    Object.defineProperty(platform, 'then', {
      get() {
        if (mode === 'throw') throw failure;
        return (resolve: (value: object) => void) => { resolve(adopted); };
      },
    });
    const result = Reflect.get(owner, 'result') as Promise<unknown>;
    const mapped = Reflect.apply(Reflect.get(owner, 'map') as () => Promise<unknown>, owner, []);
    const observed = Promise.allSettled([result, mapped]);
    implementation.pending.resolve(child);
    expect(await observed).toEqual(mode === 'adopt'
      ? [{ status: 'fulfilled', value: adopted }, { status: 'fulfilled', value: 19 }]
      : [{ status: 'rejected', reason: failure }, { status: 'rejected', reason: failure }]);
  });

  it.each(['implementation', 'platform'] as const)('delivers a private asynchronous helper result to the %s consumer', async (consumer) => {
    const realm = new TestRealm();
    const binding = new BindingWorld<TestEnvironment>([countReaderIDL]).register(realm, (ctx) => createEnvironment(realm, ctx));
    binding.install(realm.global);
    if (consumer === 'platform') {
      const CountReader = Reflect.get(realm.global, 'CountReader') as new() => { read(): Promise<number>; };
      await expect(new CountReader().read()).resolves.toBe(7);
    } else {
      const reader = new CountReaderImpl(binding.getEnvironment());
      const result = new Promise<number>((resolve, reject) => { reader.read().observe(resolve, reject); });
      await expect(result).resolves.toBe(7);
    }
  });

  it.each(['fulfill', 'reject'] as const)('retains the receiver projection on %s', async (mode) => {
    const bindings = new BindingWorld([ownerIDL, childIDL]);
    const first = new TestRealm();
    const second = new TestRealm();
    const firstBinding = bindings.register(first, (ctx) => ({ realm: ctx.realm }));
    const secondBinding = bindings.register(second, (ctx) => ({ realm: ctx.realm }));
    const implementation = new ResultOwnerImpl(firstBinding.Promise);
    const owner = firstBinding.project(ResultOwnerImpl, implementation);
    const foreign = secondBinding.project(ResultOwnerImpl, new ResultOwnerImpl(secondBinding.Promise));
    const foreignPrototype = Object.getPrototypeOf(foreign) as object;
    const result = Reflect.get(owner, 'result') as Promise<unknown>;
    expect(Reflect.get(foreignPrototype, 'result', owner)).toBe(result);
    expect(Reflect.get(owner, 'result')).toBe(result);
    expect(result).toBeInstanceOf(first.intrinsics.promise.constructor);
    expect(result).not.toBeInstanceOf(second.intrinsics.promise.constructor);
    const observed = result.catch((reason: unknown) => reason);
    const child = new ResultChildImpl();
    if (mode === 'fulfill') implementation.pending.resolve(child);
    else implementation.pending.reject(new TypeErrorRequest('read failed'));
    const value = await observed;
    if (mode === 'fulfill') expect(value).toBe(bindings.project(child));
    else expect(value).toBeInstanceOf(first.intrinsics.typeError);
    expect(Reflect.get(owner, 'result')).toBe(result);
  });
});

class ResultOwnerImpl {
  pending: InternalPromiseWithResolvers<ResultChildImpl>;
  constructor(P: typeof InternalPromise) { this.pending = P.withResolvers(implementationType<ResultChildImpl>(reference('ResultChild'))); }
  get result(): InternalPromise<ResultChildImpl> { return this.pending.promise; }
  map(): InternalPromise<number> { return this.result.then((child) => child.value, undefined, idlType.long); }
}

class ResultChildImpl {
  constructor(public value = 7) {}
}

class CountReaderImpl {
  constructor(public env: JSEnvironment) {}

  read(): InternalPromise<number> {
    return this.env.exec.Promise.resolve(undefined, idlType.undefined)
      .then(() => this.#readCount(), undefined, idlType.long);
  }

  #readCount(): InternalPromise<number> {
    return this.env.exec.Promise.resolve(7, internalType<number>());
  }
}

function createFixture() {
  const bindings = new BindingWorld([ownerIDL, childIDL]);
  const realm = new TestRealm();
  const binding = bindings.register(realm, (ctx) => ({ realm: ctx.realm }));
  const implementation = new ResultOwnerImpl(binding.Promise);
  const owner = binding.project(ResultOwnerImpl, implementation);
  return { binding, implementation, owner };
}

// interface ResultChild { readonly attribute long value; };
const childIDL = defineInterface({
  name: 'ResultChild', exposed: '*', implementation: impl(ResultChildImpl),
  members: [roAttr('value', idlType.long)],
});
// interface ResultOwner { readonly attribute Promise<ResultChild> result; };
const ownerIDL = defineInterface({
  name: 'ResultOwner', exposed: '*', implementation: impl(ResultOwnerImpl),
  members: [roAttr('result', promise(reference('ResultChild'))), op('map', promise(idlType.long))],
});

// interface CountReader { constructor(); Promise<long> read(); };
const countReaderIDL = defineInterface<JSEnvironment>({
  name: 'CountReader', exposed: '*',
  implementation: impl(CountReaderImpl, { constructWith: [atArg(0, (ctx) => ctx.getEnvironment())] }),
  members: [ctor([]), op('read', promise(idlType.long))],
});
