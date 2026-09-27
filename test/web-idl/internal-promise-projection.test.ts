import { describe, expect, it } from 'vitest';
import type { InternalPromise, InternalPromiseWithResolvers } from '../../src/infra/promises';
import { TypeError as TypeErrorRequest } from '../../src/infra/exceptions';
import { BindingWorld } from '../../src/web-idl/binding-world';
import {
  defineInterface, idlType, impl, implementationType, op, promise, reference, roAttr,
} from '../../src/web-idl/core/index';
import { TestRealm } from './test-realm';

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

  it.each(['fulfill', 'reject'] as const)('retains the receiver projection on %s', async (mode) => {
    const bindings = new BindingWorld([ownerIDL, childIDL]);
    const first = new TestRealm();
    const second = new TestRealm();
    const firstBinding = bindings.register(first);
    const secondBinding = bindings.register(second);
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

function createFixture() {
  const bindings = new BindingWorld([ownerIDL, childIDL]);
  const realm = new TestRealm();
  const binding = bindings.register(realm);
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
