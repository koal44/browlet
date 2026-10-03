import { describe, expect, it, vi } from 'vitest';

import {
  asyncIter, defineInterface, defineProxyObject, idlType, impl, iter, maplike, op, setlike,
} from '../../src/web-idl/core/index';
import { BindingWorld } from '../../src/web-idl/binding/world';
import { TestRealm } from './test-realm';

describe('Web IDL direct collection and iterable receivers', () => {
  it.each(['map', 'set', 'iterable', 'async-iterable'] as const)(
    '%s preserves direct branding, security order, and the borrowed method realm',
    (kind) => {
      class CollectionImpl {
        getEntryList(): [string, number][] { return []; }
        entries(): IterableIterator<[string, number]> { return this.getEntryList().values(); }
        ping(): boolean { return true; }
      }
      class UnrelatedImpl {}
      const alias = {};
      const resolveReceiver = vi.fn(() => target);
      const definitions = [
        defineProxyObject({ name: 'CollectionProxy', is: (value) => value === alias, resolveReceiver }),
        defineInterface({
          name: 'Collection', implementation: impl(CollectionImpl),
          members: [
            kind === 'map' ? maplike(idlType.DOMString, idlType.long)
              : kind === 'set' ? setlike(idlType.long)
                : kind === 'iterable' ? iter(idlType.long, { key: idlType.DOMString })
                  : asyncIter(idlType.long, { key: idlType.DOMString, create: 'entries' }),
            op('ping', idlType.boolean),
          ],
        }),
        defineInterface({ name: 'Unrelated', implementation: impl(UnrelatedImpl), members: [] }),
      ];
      const world = new BindingWorld(definitions);
      const methodRealm = new TestRealm();
      const receiverRealm = new TestRealm();
      const methodContext = world.register(methodRealm, (ctx) => ({ realm: ctx.realm }));
      const receiverContext = world.register(receiverRealm, (ctx) => ({ realm: ctx.realm }));
      const methodOwner = methodContext.project(CollectionImpl, new CollectionImpl());
      const target: object = receiverContext.project(CollectionImpl, new CollectionImpl());
      const unrelated = receiverContext.project(UnrelatedImpl, new UnrelatedImpl());
      const foreignContext = new BindingWorld(definitions).register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
      const foreign = foreignContext.project(CollectionImpl, new CollectionImpl());
      const methodBinding = world.getRealmBinding(methodRealm)!;
      // Ordinary operations accept both aliases and the global fallback. These
      // collection/iterable entry points deliberately require a direct receiver.
      methodBinding.globalObject = methodContext.getObjectRecord(methodOwner);
      const ping = Reflect.get(methodOwner, 'ping') as () => boolean;
      expect(Reflect.apply(ping, alias, [])).toBe(true);
      expect(Reflect.apply(ping, undefined, [])).toBe(true);
      resolveReceiver.mockClear();

      const security = vi.spyOn(methodRealm, 'performSecurityCheck');
      const receiverSecurity = vi.spyOn(receiverRealm, 'performSecurityCheck');
      const checks: { method: () => unknown; name: string; type: 'getter' | 'method'; }[] = [
        { method: Reflect.get(methodOwner, 'values') as () => unknown, name: 'values', type: 'method' },
      ];
      if (kind === 'map' || kind === 'set') {
        checks.push({
          // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise the original getter with each supplied receiver.
          method: Object.getOwnPropertyDescriptor(Object.getPrototypeOf(methodOwner), 'size')!.get!,
          name: 'size', type: 'getter',
        });
      }
      for (const { method, name, type } of checks) {
        security.mockClear();
        expect(() => Reflect.apply(method, target, [])).not.toThrow();
        expect(security).toHaveBeenCalledTimes(1);
        expect(security.mock.calls[0]![0] === target).toBe(true);
        expect(security.mock.calls[0]!.slice(1)).toEqual([name, type]);
        expect(receiverSecurity).not.toHaveBeenCalled();

        security.mockClear();
        for (const value of [undefined, null, 1, {}, alias, foreign, new Proxy(target, {})]) {
          expect(() => Reflect.apply(method, value, [])).toThrow(methodRealm.intrinsics.typeError);
        }
        expect(security).not.toHaveBeenCalled();
        expect(resolveReceiver).not.toHaveBeenCalled();

        expect(() => Reflect.apply(method, unrelated, [])).toThrow(methodRealm.intrinsics.typeError);
        expect(security).toHaveBeenCalledTimes(1);
        expect(security.mock.calls[0]![0] === unrelated).toBe(true);
        expect(security.mock.calls[0]!.slice(1)).toEqual([name, type]);
        const denied = new Error('Security denied');
        security.mockImplementationOnce(() => { throw denied; });
        expect(() => Reflect.apply(method, unrelated, [])).toThrow(denied);
      }
    },
  );
});
