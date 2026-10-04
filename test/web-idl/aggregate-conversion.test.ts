import { describe, expect, it } from 'vitest';

import { BindingWorld } from '../../src/web-idl/binding/world';
import {
  arg, ctor, defineCallbackInterface, defineInterface, idlType, impl, op, record, reference, sequence, union,
} from '../../src/web-idl/core/index';
import { TestRealm } from './test-realm';

describe('Sequence and record conversion through implementations', () => {
  it.each(['record', 'union', 'sequence'] as const)('returns an implementation %s with nested sequences', (kind) => {
    type Entries = Record<string, number[]>;
    let received!: Entries | Entries[] | boolean;
    class EchoImpl {
      echo(value: Entries | Entries[] | boolean) {
        received = value;
        return value;
      }
    }
    const entries = record(idlType.DOMString, sequence(idlType.long));
    const type = kind === 'union' ? union(entries, idlType.boolean)
      : kind === 'sequence' ? sequence(entries) : entries;
    const world = new BindingWorld([defineInterface({
      name: 'Echo', exposed: '*', implementation: impl(EchoImpl),
      members: [ctor(), op('echo', type, [arg('value', type)])],
    })]);
    const realm = new TestRealm();
    world.register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Echo = Reflect.get(realm.global, 'Echo') as new() => { echo(value: unknown): Entries | Entries[]; };
    let reads = 0;
    let coercions = 0;
    const input = {
      ['__proto__']: ['2'],
      get values() {
        reads++;
        return [{ valueOf() { coercions++; return 3; } }];
      },
    };
    Object.setPrototypeOf(input, { ignored: ['9'] });
    const result = new Echo().echo(kind === 'sequence' ? [input] : input);
    const output = Array.isArray(result) ? result[0]! : result;

    expect(output).toEqual({ ['__proto__']: [2], values: [3] });
    expect(Object.getPrototypeOf(output)).toBe(realm.intrinsics.objectPrototype);
    expect(output.values).toBeInstanceOf(realm.intrinsics.array);
    expect(reads).toBe(1);
    expect(coercions).toBe(1);
    expect(result).not.toBe(received);
    const implementation = Array.isArray(received) ? received[0]! : received;
    expect(implementation).toEqual(output);
    expect(output).not.toBe(implementation);
    expect(input['__proto__']).toEqual(['2']);
  });

  it.each(['direct', 'prepared'] as const)('consumes fresh IDL sequences in the %s implementation path', (mode) => {
    const world = new BindingWorld([]);
    const realm = new TestRealm();
    const context = world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const binding = world.getRealmBinding(realm)!;
    const type = binding.assembly.getIDLType(sequence(record(idlType.DOMString, idlType.long)));
    const input = Object.freeze([Object.freeze({ count: '4' })]);
    const converted = binding.getConverter(type).jsToIDL(input);
    const result = mode === 'direct'
      ? binding.implementationConverter.idlToImpl(converted, type, {}, context)
      : binding.implementationConverter.createConverter(type, {})(converted, context);

    expect(result).toBe(converted);
    expect(result).toEqual([{ count: 4 }]);
    expect(result).not.toBe(input);
    expect(input[0]!.count).toBe('4');
  });

  it.each(['record', 'sequence'] as const)('unwraps and reprojects %s values without changing platform identity or realm', (kind) => {
    class ItemImpl { value = 1; }
    type Entries<Value> = Record<string, Value> | Value[];
    let received!: Entries<ItemImpl>;
    class EchoImpl {
      echo(value: Entries<ItemImpl>) { received = value; return value; }
    }
    const type = kind === 'sequence' ? sequence(reference(ItemImpl)) : record(idlType.DOMString, reference(ItemImpl));
    const world = new BindingWorld([
      defineInterface({ name: 'Item', implementation: impl(ItemImpl), members: [] }),
      defineInterface({
        name: 'Echo', exposed: '*', implementation: impl(EchoImpl),
        members: [ctor(), op('echo', type, [arg('value', type)])],
      }),
    ]);
    const realm = new TestRealm();
    const otherRealm = new TestRealm();
    world.register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const other = world.register(otherRealm, (ctx) => ({ realm: ctx.realm }));
    const implementation = new ItemImpl();
    const platform = other.project(ItemImpl, implementation);
    const Echo = Reflect.get(realm.global, 'Echo') as new() => { echo(value: unknown): Entries<object>; };
    const result = new Echo().echo(kind === 'sequence' ? [platform] : { item: platform });
    const item = Array.isArray(result) ? result[0]! : result.item!;

    expect(Array.isArray(received) ? received[0] : received.item).toBe(implementation);
    expect(item).toBe(platform);
    expect(Object.getPrototypeOf(result)).toBe(kind === 'sequence'
      ? realm.intrinsics.array.prototype : realm.intrinsics.objectPrototype);
    expect(other.getObjectRecord(item)!.binding.realm).toBe(otherRealm);
    expect(() => new Echo().echo(kind === 'sequence' ? [{}] : { item: {} })).toThrow(realm.intrinsics.typeError);
  });

  it.each(['direct', 'prepared'] as const)('converts callback-interface records through a union in the %s path', (mode) => {
    let calls = 0;
    const callback = defineCallbackInterface({
      name: 'Reader', members: [op('read', idlType.long)],
      toImpl: (_context, cbValue) => () => cbValue.callUserObjectOperation('read', []),
    });
    const world = new BindingWorld([callback]);
    const realm = new TestRealm();
    const context = world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const binding = world.getRealmBinding(realm)!;
    const type = binding.assembly.getIDLType(union(record(idlType.DOMString, reference('Reader')), idlType.boolean));
    const input = { ['__proto__']: { read() { calls++; return '7'; } } };
    const converted = binding.getConverter(type).jsToIDL(input);
    const result = (mode === 'direct'
      ? binding.implementationConverter.idlToImpl(converted, type, {}, context)
      : binding.implementationConverter.createConverter(type, {})(converted, context)) as Record<string, () => unknown>;

    expect(Object.hasOwn(result, '__proto__')).toBe(true);
    expect(result['__proto__']!()).toBe(7);
    expect(calls).toBe(1);
    expect(typeof input['__proto__'].read).toBe('function');
  });

  it.each(['direct', 'prepared'] as const)('keeps custom unwrapping scoped to the binding world in the %s path', (mode) => {
    class ItemImpl { value = 1; }
    const definition = defineInterface({ name: 'Item', implementation: impl(ItemImpl), members: [] });
    const realm = new TestRealm();
    const world = new BindingWorld([definition]);
    const context = world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const binding = world.getRealmBinding(realm)!;
    const other = world.register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
    const foreign = new BindingWorld([definition]).register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
    const implInst = new ItemImpl();
    const platform = other.project(ItemImpl, implInst);
    const foreignPlatform = foreign.project(ItemImpl, new ItemImpl());
    const type = binding.assembly.getIDLType(union(idlType.object, idlType.boolean));
    const options = { implClasses: [ItemImpl] };
    const prepared = binding.implementationConverter.createConverter(type, options);
    const convert = (value: unknown) => {
      const converted = binding.getConverter(type).jsToIDL(value);
      return mode === 'direct'
        ? binding.implementationConverter.idlToImpl(converted, type, options, context)
        : prepared(converted, context);
    };

    expect(convert(platform)).toBe(implInst);
    expect(convert(foreignPlatform)).toBe(foreignPlatform);
    expect(convert(false)).toBe(false);
  });
});
