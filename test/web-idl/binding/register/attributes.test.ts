import { assert, describe, expect, it } from 'vitest';

import {
  attr, attrFn, onError, ctor, defineEnumeration, defineInterface, idlType, impl, nullable, roAttr,
  reference,
} from '../../../../src/web-idl/core/index';
import { getImplementationObject } from '../../../../src/web-idl/binding/platform';
import { BindingWorld } from '../../../../src/web-idl/binding/world';

import { TestRealm as Realm } from '../../../support/web-idl-realm';

describe('Web IDL implementation attribute registration', () => {
  it('creates shared function-valued attributes with ordinary call behavior', () => {
    class AttributeFunctionImpl {}
    const callback = function(this: unknown, ...args: unknown[]) {
      return { receiver: this, args };
    };
    const definition = defineInterface({
      name: 'AttributeFunction', exposed: '*', implementation: impl(AttributeFunctionImpl),
      members: [
        ctor(),
        roAttr('first', reference('Function'), attrFn(() => callback)),
        roAttr('second', reference('Function'), attrFn(() => callback)),
      ],
    });
    const realm = new Realm();
    const bindings = new BindingWorld([definition]);
    bindings.register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Constructor = Reflect.get(realm.global, definition.name) as new() => object;
    const first = new Constructor();
    const second = new Constructor();
    const function_ = Reflect.get(first, 'first') as CallableFunction;

    expect(function_).toBe(Reflect.get(first, 'first'));
    expect(function_).toBe(Reflect.get(second, 'first'));
    expect(function_).not.toBe(Reflect.get(first, 'second'));
    expect(function_).toBeInstanceOf(realm.intrinsics.function);
    expect(function_.name).toBe('first');
    expect(function_.length).toBe(callback.length);
    expect(Object.hasOwn(function_, 'prototype')).toBe(false);
    expect(() => { Reflect.construct(function_, []); }).toThrow(TypeError);
    const receiver = {};
    const argument = {};
    const result = Reflect.apply(function_, receiver, [argument, 7, 'extra']) as {
      receiver: unknown; args: unknown[];
    };
    expect(result.receiver).toBe(receiver);
    expect(result.args).toEqual([argument, 7, 'extra']);
    expect(result.args[0]).toBe(argument);
    expect(Reflect.apply(function_, undefined, [])).toEqual({ receiver: undefined, args: [] });
  });

  it('calls the declared setter of a function-valued attribute', () => {
    class AttributeFunctionImpl {}
    let assignedResult: unknown;
    const definition = defineInterface({
      name: 'AttributeFunction', exposed: '*', implementation: impl(AttributeFunctionImpl),
      members: [
        ctor(),
        attr('handler', reference('Function'), {
          ...attrFn(() => () => 1),
          ...onError('rethrow'),
          set(_context, value) { assignedResult = (value as () => unknown)(); },
        }),
      ],
    });
    const realm = new Realm();
    new BindingWorld([definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Constructor = Reflect.get(realm.global, definition.name) as new() => {
      handler: () => number;
    };
    const object = new Constructor();
    const initial = object.handler;
    const replacement = () => 2;

    object.handler = replacement;

    expect(assignedResult).toBe(2);
    expect(object.handler).toBe(initial);
    expect(object.handler()).toBe(1);
  });

  it('binds implementation fields with IDL conversion and readonly exposure', () => {
    class FieldsImpl {
      count = 1;
      label = 'initial';
      next: FieldsImpl | null = null;
      optional: unknown = undefined;
      internal = 'implementation only';
    }
    const definition = defineInterface({
      name: 'Fields', exposed: '*', implementation: impl(FieldsImpl),
      members: [
        ctor(), attr('count', idlType.long), roAttr('label', idlType.DOMString),
        attr('next', nullable(reference('Fields'))), roAttr('optional', idlType.any),
      ],
    });
    const realm = new Realm();
    new BindingWorld([definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Fields = Reflect.get(realm.global, definition.name) as new() => {
      count: number; label: string; next: object | null; optional: unknown;
    };
    const object = new Fields();
    const next = new Fields();
    const implementation = getImplementationObject(object);
    assert(implementation instanceof FieldsImpl);

    expect(object.count).toBe(1);
    expect(object.optional).toBeUndefined();
    Reflect.set(object, 'count', { valueOf: () => 7.9 });
    expect(implementation.count).toBe(7);
    expect(object.count).toBe(7);
    object.next = next;
    expect(implementation.next).toBe(getImplementationObject(next));
    expect(object.next).toBe(next);
    implementation.label = 'updated';
    expect(object.label).toBe('updated');
    expect(Reflect.set(object, 'label', 'author assignment')).toBe(false);
    expect(implementation.label).toBe('updated');
    expect(typeof Object.getOwnPropertyDescriptor(Fields.prototype, 'count')?.get).toBe('function');
    expect('internal' in object).toBe(false);
  });

  it('coerces automatic enum setters once and keeps borrowed-setter errors in the method realm', () => {
    class ModeHolderImpl { mode = 'fast'; }
    const definition = defineInterface({
      name: 'ModeHolder', exposed: '*', implementation: impl(ModeHolderImpl),
      members: [ctor(), attr('mode', reference('Mode'))],
    });
    const world = new BindingWorld([
      defineEnumeration({ name: 'Mode', values: ['fast', 'slow'] }), definition,
    ]);
    const realm = new Realm();
    const foreignRealm = new Realm();
    for (const currentRealm of [realm, foreignRealm]) {
      world.register(currentRealm, (ctx) => ({ realm: ctx.realm })).install(currentRealm.global);
    }
    const ModeHolder = Reflect.get(realm.global, 'ModeHolder') as new() => { mode: string; };
    const ForeignModeHolder = Reflect.get(foreignRealm.global, 'ModeHolder') as typeof ModeHolder;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Borrowed accessor is applied to an explicit receiver.
    const setter = Object.getOwnPropertyDescriptor(ForeignModeHolder.prototype, 'mode')!.set!;
    const object = new ModeHolder();
    let coercions = 0;
    Reflect.apply(setter, object, [{ toString() { coercions++; return 'slow'; } }]);
    expect(coercions).toBe(1);
    expect(object.mode).toBe('slow');
    Reflect.apply(setter, object, ['invalid']);
    expect(object.mode).toBe('slow');
    Reflect.apply(setter, object, ['fast']);
    expect(object.mode).toBe('fast');
    expect(() => Reflect.apply(setter, object, [Symbol('mode')]))
      .toThrow(foreignRealm.intrinsics.typeError);
    expect(() => Reflect.apply(setter, {}, ['fast']))
      .toThrow(foreignRealm.intrinsics.typeError);
    const thrown = new Error('coercion failed');
    let caught: unknown;
    try { Reflect.apply(setter, object, [{ toString() { throw thrown; } }]); }
    catch (exception) { caught = exception; }
    expect(caught).toBe(thrown);
  });

  it('uses live field descriptors and preserves errors thrown by implementation setters', () => {
    class FieldImpl { value = 1; }
    const definition = defineInterface({
      name: 'Field', exposed: '*', implementation: impl(FieldImpl),
      members: [ctor(), attr('value', idlType.long)],
    });
    const realm = new Realm();
    new BindingWorld([definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Field = Reflect.get(realm.global, 'Field') as new() => { value: number; };
    const object = new Field();
    const implementation = getImplementationObject(object);
    assert(implementation instanceof FieldImpl);
    const thrown = new Error('implementation setter failed');
    let writes = 0;
    Object.defineProperty(implementation, 'value', {
      configurable: true,
      set() { writes++; throw thrown; },
    });
    let caught: unknown;
    try { object.value = 2; }
    catch (exception) { caught = exception; }
    expect(caught).toBe(thrown);
    expect(writes).toBe(1);
    Object.defineProperty(implementation, 'value', { value: 1, writable: false });
    expect(() => { object.value = 2; }).toThrow();
    expect(implementation.value).toBe(1);
  });

  it('retains implementation accessors and supports static fields', () => {
    class BaseImpl {
      #value = 2;
      get value(): number { return this.#value * 2; }
      set value(value: number) { this.#value = value; }
    }
    class AttributesImpl extends BaseImpl {
      static label = 'initial';
      static get alias(): string { return this.label; }
    }
    const definition = defineInterface({
      name: 'Attributes', exposed: '*', implementation: impl(AttributesImpl),
      members: [
        ctor(), attr('value', idlType.long),
        attr('label', idlType.DOMString, { static: true }),
        roAttr('alias', idlType.DOMString, { static: true }),
      ],
    });
    const realm = new Realm();
    new BindingWorld([definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Attributes = Reflect.get(realm.global, definition.name) as {
      new(): { value: number; }; label: string; alias: string;
    };
    const object = new Attributes();

    expect(object.value).toBe(4);
    object.value = 3;
    expect(object.value).toBe(6);
    Reflect.set(Attributes, 'label', { toString: () => 'updated' });
    expect(AttributesImpl.label).toBe('updated');
    expect(Attributes.label).toBe('updated');
    expect(Attributes.alias).toBe('updated');
  });

  it('reports missing implementation fields when an attribute is accessed', () => {
    class MissingImpl {}
    const definition = defineInterface({
      name: 'Missing', exposed: '*', implementation: impl(MissingImpl),
      members: [ctor(), attr('value', idlType.long)],
    });
    const realm = new Realm();
    new BindingWorld([definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Missing = Reflect.get(realm.global, definition.name) as new() => { value: number; };
    const object = new Missing();

    expect(() => object.value).toThrow('Web IDL attribute value has no implementation');
    expect(() => { object.value = 1; }).toThrow('Web IDL attribute value has no implementation');
  });
});
