import { describe, expect, it } from 'vitest';

import {
  arg, ctor, defineInterface, definePartialInterface, idlType, impl, indexedGetter, nullable, op, reference, roAttr, union,
} from '../../../../src/web-idl/core/index';
import { BindingWorld } from '../../../../src/web-idl/binding/world';

import { installTestBindings } from '../../../support/web-idl-binding';

describe('Web IDL legacy property registration', () => {
  it.each([undefined, 'namedItem'])('projects typed named results with exposed method %s', (name) => {
    class ItemImpl {
      label = 'item';
    }
    class OtherImpl {
      label = 'other';
    }
    class CollectionImpl {
      values = new Map<string, ItemImpl | OtherImpl>([['first', new ItemImpl()], ['second', new OtherImpl()]]);

      lookup(key: string): ItemImpl | OtherImpl | null {
        return this.values.get(key) ?? null;
      }

      getSupportedPropertyNames(): ReadonlySet<string> {
        return new Set(this.values.keys());
      }
    }
    const world = new BindingWorld([
      defineInterface({
        name: 'Item', exposed: '*', implementation: impl(ItemImpl), members: [roAttr('label', idlType.DOMString)],
      }),
      defineInterface({
        name: 'Other', exposed: '*', implementation: impl(OtherImpl), members: [roAttr('label', idlType.DOMString)],
      }),
      defineInterface({ name: 'Collection', exposed: '*', implementation: impl(CollectionImpl), members: [ctor()] }),
      definePartialInterface({
        name: 'Collection', members: [{
          kind: 'named-getter', method: 'lookup', name,
          returns: nullable(union(reference('Item'), reference('Other'))), serializedType: idlType.object,
        }],
      }),
    ]);
    const { context, globalObject, realm } = installTestBindings(world);
    const Collection = Reflect.get(globalObject, 'Collection') as new() => object;
    const collection = new Collection();
    const implementation = context.unwrap(collection, CollectionImpl)!;
    const first: unknown = Reflect.get(collection, 'first');
    expect(first).toBeInstanceOf(Reflect.get(globalObject, 'Item'));
    expect(Reflect.get(collection, 'second')).toBeInstanceOf(Reflect.get(globalObject, 'Other'));
    expect(first).not.toBe(implementation.values.get('first'));
    expect(Reflect.get(collection, 'first')).toBe(first);
    expect(Reflect.get(collection, 'missing')).toBeUndefined();
    expect(Object.keys(collection)).toEqual(['first', 'second']);
    expect(Reflect.has(collection, 'lookup')).toBe(false);

    if (name !== undefined) {
      const namedItem = Reflect.get(collection, name) as (name: unknown) => object | null;
      expect(namedItem.call(collection, { toString: () => 'first' })).toBe(first);
      expect(namedItem.call(collection, 'missing')).toBeNull();
      expect(() => { Reflect.apply(namedItem, collection, []); }).toThrow(realm.TypeError);
      expect(() => namedItem.call(collection, Symbol())).toThrow(realm.TypeError);

      const otherRealm = installTestBindings(world);
      const otherCollection = Reflect.get(otherRealm.globalObject, 'Collection') as { prototype: object; };
      const borrowed = Reflect.get(otherCollection.prototype, name) as typeof namedItem;
      expect(borrowed.call(collection, 'first')).toBe(first);
    }

    implementation.values.delete('first');
    expect(Reflect.has(collection, 'first')).toBe(false);
    expect(Object.keys(collection)).toEqual(['second']);
  });

  it.each([true, false])('uses an explicit anonymous setter binding (indexed: %s)', (indexed) => {
    class CollectionImpl {
      values = new Map<string, number>([['0', 1]]);

      item(key: number | string): number | null {
        return this.values.get(String(key)) ?? null;
      }

      getSupportedPropertyNames(): ReadonlySet<string> {
        return new Set(this.values.keys());
      }
    }
    const keyType = indexed ? idlType.unsignedLong : idlType.DOMString;
    const definition = defineInterface({
      name: 'Collection', exposed: '*', implementation: impl(CollectionImpl),
      members: [
        ctor(),
        indexed ? op('item', nullable(idlType.long),
          [arg('key', keyType)],
          indexedGetter((collection: CollectionImpl) => [...collection.values.keys()].map(Number), { unsupportedValue: null }),
        ) : { kind: 'named-getter', name: 'item', method: 'item', returns: nullable(idlType.long) },
        op(undefined, idlType.undefined,
          [arg('key', keyType), arg('value', idlType.long)],
          {
            special: 'setter',
            invoke(_env, key, value) {
              (this as CollectionImpl).values.set(String(key), value);
            },
          },
        ),
      ],
    });
    const { globalObject } = installTestBindings(new BindingWorld([definition]));
    const Collection = Reflect.get(globalObject, 'Collection') as new() => object;
    const collection = new Collection();
    const newKey = indexed ? '2' : 'next';
    expect(Reflect.set(collection, '0', '4')).toBe(true);
    expect(Reflect.set(collection, newKey, '5')).toBe(true);
    expect(Reflect.get(collection, '0')).toBe(4);
    expect(Reflect.get(collection, newKey)).toBe(5);
    expect(Reflect.defineProperty(collection, newKey, { value: 6 })).toBe(true);
    expect(Reflect.get(collection, newKey)).toBe(6);
  });

  it('uses an explicit anonymous deleter binding and preserves its failure result', () => {
    class CollectionImpl {
      values = new Map<string, number>([['removed', 1], ['retained', 2]]);

      item(name: string): number | null {
        return this.values.get(name) ?? null;
      }

      getSupportedPropertyNames(): ReadonlySet<string> {
        return new Set(this.values.keys());
      }
    }
    const definition = defineInterface({
      name: 'Collection', exposed: '*', implementation: impl(CollectionImpl),
      members: [
        ctor(),
        { kind: 'named-getter', name: 'item', method: 'item', returns: nullable(idlType.long) },
        op(undefined, idlType.boolean,
          [arg('name', idlType.DOMString)],
          {
            special: 'deleter',
            invoke(_env, name) {
              return name !== 'retained' && (this as CollectionImpl).values.delete(name);
            },
          },
        ),
      ],
    });
    const { globalObject } = installTestBindings(new BindingWorld([definition]));
    const Collection = Reflect.get(globalObject, 'Collection') as new() => object;
    const collection = new Collection();
    expect(Reflect.deleteProperty(collection, 'removed')).toBe(true);
    expect(Reflect.has(collection, 'removed')).toBe(false);
    expect(Reflect.deleteProperty(collection, 'retained')).toBe(false);
    expect(Reflect.get(collection, 'retained')).toBe(2);
  });

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
    const { globalObject } = installTestBindings(new BindingWorld([definition]));
    const Collection = Reflect.get(globalObject, 'Collection') as new() => {
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
    const { globalObject } = installTestBindings(new BindingWorld([definition]));
    const Collection = Reflect.get(globalObject, 'Collection') as new() => object;
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

      getSupportedPropertyNames(): ReadonlySet<string> {
        return new Set(['first']);
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
        { kind: 'named-getter', name: 'namedItem', method: 'namedItem', returns: nullable(idlType.DOMString) },
      ],
    });
    const world = new BindingWorld([collectionIDL]);
    const { globalObject } = installTestBindings(world);
    const Collection = Reflect.get(globalObject, collectionIDL.name) as {
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
