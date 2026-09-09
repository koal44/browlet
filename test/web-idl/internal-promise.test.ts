import { describe, expect, it } from 'vitest';
import { InternalPromise } from '../../src/js-engine/index';
import { TypeError as TypeErrorRequest } from '../../src/js-engine/simple-exception';
import { createBindings } from '../../src/web-idl/registration';
import {
  defineInterface, idlType, impl, promise, reference, roAttr,
} from '../../src/web-idl/declaration/index';
import { TestRealm } from './test-realm';

describe('internal Promise result projection', () => {
  it.each(['fulfill', 'reject'] as const)('retains the receiver projection on %s', async (mode) => {
    const bindings = createBindings([ownerIDL, childIDL]);
    const first = new TestRealm();
    const second = new TestRealm();
    const firstBinding = bindings.register(first);
    const secondBinding = bindings.register(second);
    const implementation = new ResultOwnerImpl();
    const owner = firstBinding.context.project(ResultOwnerImpl, implementation);
    const foreign = secondBinding.context.project(ResultOwnerImpl, new ResultOwnerImpl());
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
    if (mode === 'fulfill') expect(value).toBe(bindings.getPlatformObject(child));
    else expect(value).toBeInstanceOf(first.intrinsics.typeError);
    expect(Reflect.get(owner, 'result')).toBe(result);
  });
});

class ResultOwnerImpl {
  readonly pending = InternalPromise.withResolvers<ResultChildImpl>();
  get result(): InternalPromise<ResultChildImpl> { return this.pending.promise; }
}

class ResultChildImpl {
  get value(): number { return 7; }
}

// interface ResultChild { readonly attribute long value; };
const childIDL = defineInterface({
  name: 'ResultChild', exposed: '*', implementation: impl(ResultChildImpl),
  members: [roAttr('value', idlType.long)],
});
// interface ResultOwner { readonly attribute Promise<ResultChild> result; };
const ownerIDL = defineInterface({
  name: 'ResultOwner', exposed: '*', implementation: impl(ResultOwnerImpl),
  members: [roAttr('result', promise(reference('ResultChild')))],
});
