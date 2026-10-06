import { types } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
  BindingWorld, DOMExceptionImpl, QuotaExceededErrorImpl,
  defineInterface, impl, roAttr, reference, op, idlType,
} from '../../../../src/web-idl/index';

import { TestRealm } from '../../../support/web-idl-realm';

describe('DOMException implementation projection', () => {
  it('projects frozen exception state without adding visible implementation properties', () => {
    const context = createContext();
    const value = Object.freeze(new DOMExceptionImpl('missing', 'NotFoundError'));
    const keys = Reflect.ownKeys(value);
    const platform = context.realizeException(value);

    expect(platform).toBeInstanceOf(context.DOMException);
    expect(types.isNativeError(platform)).toBe(true);
    expect(context.unwrap(platform, DOMExceptionImpl)).toBe(value);
    expect(Reflect.ownKeys(value)).toEqual(keys);
    expect(Object.isFrozen(value)).toBe(true);
    expect(platform).toMatchObject({ name: 'NotFoundError', message: 'missing', code: 8 });
  });

  it('reuses the original platform identity across realms and worlds', () => {
    const world = new BindingWorld([]);
    const first = createContext(world);
    const second = createContext(world);
    const unrelated = createContext();
    const value = new DOMExceptionImpl('original', 'AbortError');
    const platform = first.realizeException(value) as object;

    expect(platform).toBeInstanceOf(first.DOMException);
    Object.defineProperty(platform, 'message', { value: 'author override' });
    for (const context of [first, second, unrelated]) {
      expect(context.realizeException(value)).toBe(platform);
      expect(context.realizeException(platform)).toBe(platform);
    }
    expect(platform).toHaveProperty('message', 'author override');
    expect(unrelated.getObjectRecord(value)).toBeUndefined();
  });

  it('respects ownership associated before the first projection', () => {
    const world = new BindingWorld([]);
    const first = createContext(world);
    const second = createContext(world);
    const value = new DOMExceptionImpl('owned', 'AbortError');
    first.associate(DOMExceptionImpl, value);

    expect(second.realizeException(value)).toBeInstanceOf(first.DOMException);
  });

  it('preserves a derived exception interface and its additional state', () => {
    const context = createContext();
    const value = new QuotaExceededErrorImpl('full', { quota: 10, requested: 20 });
    const platform = context.realizeException(value);

    expect(platform).toBeInstanceOf(Reflect.get(context.realm.global, 'QuotaExceededError'));
    expect(platform).toMatchObject({ name: 'QuotaExceededError', quota: 10, requested: 20 });
    expect(context.unwrap(platform, QuotaExceededErrorImpl)).toBe(value);
  });

  it('uses a borrowed method realm for a newly thrown implementation', () => {
    class OwnerImpl {
      fail(): never { throw new DOMExceptionImpl('failure', 'InvalidStateError'); }
    }
    const definition = defineInterface({
      name: 'Owner', exposed: '*', implementation: impl(OwnerImpl),
      members: [op('fail', idlType.undefined)],
    });
    const world = new BindingWorld([definition]);
    const first = createContext(world);
    const second = createContext(world);
    const owner = first.project(OwnerImpl, new OwnerImpl());
    const otherOwner = second.project(OwnerImpl, new OwnerImpl());
    const method = Reflect.get(otherOwner, 'fail') as () => never;
    const error = caught(() => Reflect.apply(method, owner, []));

    expect(error).toBeInstanceOf(second.DOMException);
    expect(error).not.toBeInstanceOf(first.DOMException);
  });

  it('uses the receiver owner for a stored interface-valued exception', () => {
    class HolderImpl { error = new DOMExceptionImpl('read failed', 'NotReadableError'); }
    const definition = defineInterface({
      name: 'Holder', exposed: '*', implementation: impl(HolderImpl),
      members: [roAttr('error', reference(DOMExceptionImpl))],
    });
    const world = new BindingWorld([definition]);
    const first = createContext(world);
    const second = createContext(world);
    const holder = new HolderImpl();
    const object = first.project(HolderImpl, holder);
    const foreign = second.project(HolderImpl, new HolderImpl());
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Explicitly apply the borrowed getter to its receiver.
    const getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(foreign), 'error')!.get!;
    const error: unknown = Reflect.apply(getter, object, []);

    expect(error).toBeInstanceOf(first.DOMException);
    expect(Reflect.get(object, 'error')).toBe(error);
    expect(first.unwrap(error, DOMExceptionImpl)).toBe(holder.error);
    expect(second.realizeException(holder.error)).toBe(error);
  });

  it('shares one projected rejection between declared promises', async () => {
    const world = new BindingWorld([]);
    const first = createContext(world);
    const second = createContext(world);
    const value = new DOMExceptionImpl('rejected', 'AbortError');
    const one = first.Promise.reject(value, idlType.undefined);
    const two = second.Promise.reject(value, idlType.undefined);
    const observe = (promise: typeof one) => new Promise<unknown>((resolve, reject) => promise.observe(
      () => { reject(new Error('Expected rejection')); }, resolve,
    ));
    const [a, b] = await Promise.all([observe(one), observe(two)]);

    expect(a).toBeInstanceOf(first.DOMException);
    expect(a).toBe(b);
    expect(first.unwrap(a, DOMExceptionImpl)).toBe(value);
  });
});

function createContext(world = new BindingWorld([])) {
  const context = world.register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
  context.install(context.realm.global);
  return context;
}

function caught(steps: () => unknown): unknown {
  try { steps(); }
  catch (error) { return error; }
  throw new Error('Expected an exception');
}
