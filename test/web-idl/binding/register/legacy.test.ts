import { describe, expect, it } from 'vitest';

import {
  arg, ctor, defineInterface, idlType, impl, indexedGetter, namedGetter, nullable, op,
} from '../../../../src/web-idl/core/index';
import { BindingWorld } from '../../../../src/web-idl/binding/world';

import { TestRealm as Realm } from '../../../support/web-idl-realm';

describe('Web IDL legacy property registration', () => {
  it.each([null, undefined])('uses an explicit %s result for unsupported indices', (unsupportedValue) => {
    class CollectionImpl {
      item(index: number): string | null | undefined {
        return index === 2 ? 'second' : unsupportedValue;
      }
    }

    const definition = defineInterface({
      name: 'Collection', exposed: '*', implementation: impl(CollectionImpl),
      members: [
        ctor(),
        op('item', idlType.any,
          [arg('index', idlType.unsignedLong)],
          indexedGetter(() => [2], { unsupportedValue }),
        ),
      ],
    });
    const realm = new Realm();
    new BindingWorld([definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Collection = Reflect.get(realm.global, 'Collection') as new() => {
      item(index: number): string | null | undefined;
      [index: number]: string | undefined;
    };
    const collection = new Collection();

    expect(collection[2]).toBe('second');
    expect(collection[0]).toBeUndefined();
    expect(collection.item(0)).toBe(unsupportedValue);
    expect(Reflect.has(collection, '2')).toBe(true);
    expect(Reflect.has(collection, '0')).toBe(false);
    expect(Object.keys(collection)).toEqual(['2']);
    expect(Reflect.deleteProperty(collection, '2')).toBe(false);
    expect(Reflect.deleteProperty(collection, '0')).toBe(true);

    Object.defineProperty(Collection.prototype, '0', { value: 'inherited' });
    expect(collection[0]).toBe('inherited');
    expect(Object.hasOwn(collection, '0')).toBe(false);
    expect(collection.item(0)).toBe(unsupportedValue);
  });

  it('uses an index predicate when supported entries can be null or undefined', () => {
    class CollectionImpl {
      values = new Map<number, unknown>([[3, null], [0, undefined]]);

      item(index: number): unknown {
        if (!this.values.has(index)) throw new Error('Unsupported index');
        return this.values.get(index);
      }
    }

    const definition = defineInterface({
      name: 'Collection', exposed: '*', implementation: impl(CollectionImpl),
      members: [
        ctor(),
        op('item', idlType.any,
          [arg('index', idlType.unsignedLong)],
          indexedGetter(
            (collection: CollectionImpl) => collection.values.keys(),
            { supportsIndex: (collection, index) => collection.values.has(index) },
          ),
        ),
      ],
    });
    const realm = new Realm();
    new BindingWorld([definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Collection = Reflect.get(realm.global, 'Collection') as new() => object;
    const collection = new Collection();

    expect(Reflect.get(collection, '3')).toBeNull();
    expect(Object.hasOwn(collection, '3')).toBe(true);
    expect(Object.hasOwn(collection, '0')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(collection, '0')?.value).toBeUndefined();
    expect(Reflect.get(collection, '1')).toBeUndefined();
    expect(Object.hasOwn(collection, '1')).toBe(false);
    expect(Reflect.ownKeys(collection)).toEqual(['0', '3']);
    expect(Reflect.deleteProperty(collection, '0')).toBe(false);
    expect(Reflect.deleteProperty(collection, '1')).toBe(true);
  });

  it('combines declarative legacy hooks with automatic operation binding', () => {
    class CollectionImpl {
      values = ['first', 'second'];

      item(index: number): string | null {
        return this.values[index] ?? null;
      }

      namedItem(name: string): string | null {
        return name === 'first' ? this.values[0]! : null;
      }
    }

    const collectionIDL = defineInterface({
      name: 'Collection',
      exposed: 'Window',
      implementation: impl(CollectionImpl),
      members: [
        ctor(),
        op('item', nullable(idlType.DOMString),
          [arg('index', idlType.unsignedLong)],
          indexedGetter(
            (collection: CollectionImpl) => collection.values.keys(),
            { unsupportedValue: null },
          ),
        ),
        op('namedItem', nullable(idlType.DOMString),
          [arg('name', idlType.DOMString)],
          namedGetter(() => new Set(['first'])),
        ),
      ],
    });
    const realm = new Realm();
    const world = new BindingWorld([collectionIDL]);
    world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const binding = world.getRealmBinding(realm)!;
    binding.installDefinitions();
    const Collection = Reflect.get(realm.global, collectionIDL.name) as {
      new(): {
        [index: number]: string;
        [name: string]: unknown;
        item(index: number): string | null;
        namedItem(name: string): string | null;
      };
    };

    const collection = new Collection();

    expect(collection.item(1)).toBe('second');
    expect(collection.namedItem('first')).toBe('first');
    expect(collection[1]).toBe('second');
    expect(collection.first).toBe('first');
  });
});
