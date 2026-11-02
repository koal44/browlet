import { describe, expect, it, vi } from 'vitest';

import {
  arg, atArg, attr, cbDict, ctor, defineCallbackFunction, defineDictionary, defineInterface, defineNamespace, defineTypedef,
  idlType, impl, invokeWith, nullable, op, reference, roAttr, staticOp, xattr, type OverrideEnvironments,
} from '../../../src/web-idl/core/index';
import { BindingWorld } from '../../../src/web-idl/binding/world';
import { installTestBindings } from '../../support/web-idl-binding';
import { TestRealm } from '../../support/web-idl-realm';

describe('Binding invocation inputs', () => {
  it('keeps receiver and method inputs separate and resolves after successful conversion', () => {
    const received: unknown[][] = [];
    const incumbent = { realm: new TestRealm() };
    const lookup = vi.fn(() => incumbent);
    const resolve = vi.fn((env: unknown, methodEnv: unknown, incumbentEnv: unknown) => [env, methodEnv, incumbentEnv]);
    class Holder {
      read(inputs: unknown) { received.push([this, inputs]); return 'read'; }
      write(value: string, inputs: unknown) { received.push([this, value, inputs]); }
    }
    const world = new BindingWorld([
      defineInterface({
        name: 'Holder', exposed: '*', implementation: impl(Holder), members: [
          ctor(), attr('value', idlType.DOMString, {
            overrideCapturesIncumbent: true,
            overrideGet({ relevant, callee, incumbent }) { return (this as Holder).read(resolve(relevant, callee, incumbent)); },
            overrideSet({ relevant: env, callee: methodEnv, incumbent: incumbentEnv }, value) {
              (this as Holder).write(value as string, resolve(env, methodEnv, incumbentEnv));
            },
          }),
          op('write', idlType.undefined,
            [arg('value', idlType.DOMString)], invokeWith(atArg(1, resolve)),
          ),
          op('writeOverride', idlType.undefined,
            [arg('value', idlType.DOMString)],
            {
              overrideCapturesIncumbent: true,
              overrideInvoke({ relevant, callee, incumbent }, value) {
                (this as Holder).write(value, resolve(relevant, callee, incumbent));
              },
            },
          ),
        ],
      }),
    ], { getIncumbentEnvironment: lookup });
    const first = installTestBindings(world);
    const second = installTestBindings(world);
    const First = Reflect.get(first.globalObject, 'Holder') as new() => object;
    const Second = Reflect.get(second.globalObject, 'Holder') as new() => object;
    const receiver = new Second();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Deliberately borrow both accessors with Reflect.apply.
    const { get, set } = Object.getOwnPropertyDescriptor(First.prototype, 'value')!;
    expect(Reflect.apply(get!, receiver, [])).toBe('read');
    const convert = vi.fn(() => 'converted');
    Reflect.apply(set!, receiver, [{ toString: convert }]);
    expect(convert).toHaveBeenCalledOnce();
    const inputs = [second.context.getEnvironment(), first.context.getEnvironment(), incumbent];
    expect(received[0]![1]).toEqual(inputs);
    expect(received[1]!.slice(1)).toEqual(['converted', inputs]);
    expect(received[0]![0]).toBe(received[1]![0]);
    Reflect.apply(Reflect.get(First.prototype, 'write') as (...args: unknown[]) => void, receiver, ['operation']);
    expect(received[2]!.slice(1)).toEqual(['operation', inputs]);
    Reflect.apply(Reflect.get(First.prototype, 'writeOverride') as (...args: unknown[]) => void, receiver, ['override']);
    expect(received[3]!.slice(1)).toEqual(['override', inputs]);
    expect(lookup).toHaveBeenCalledTimes(4);
    expect(lookup).toHaveBeenLastCalledWith(first.context.getEnvironment());
    resolve.mockClear();
    lookup.mockClear();
    const error = new Error('conversion');
    expect(() => Reflect.apply(set!, receiver, [{ toString() { throw error; } }])).toThrow(error);
    expect(() => { Reflect.apply(Reflect.get(First.prototype, 'writeOverride') as () => void, receiver,
      [{ toString() { throw error; } }]); }).toThrow(error);
    expect(resolve).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(received).toHaveLength(4);
  });

  it.each([true, false, undefined])('selects override capture explicitly (%s), independently of the signature', (flag) => {
    let incumbent: { realm: TestRealm; } | undefined = { realm: new TestRealm() };
    const lookup = vi.fn(() => incumbent);
    const received: OverrideEnvironments[] = [];
    class Holder {}
    const world = new BindingWorld([
      defineInterface({
        name: 'Holder', exposed: '*', implementation: impl(Holder), members: [
          ctor(
            [arg('label', idlType.DOMString)],
            {
              overrideCapturesIncumbent: flag,
              overrideConstruct(environments, label) {
                expect(label).toBe('converted');
                received.push(environments);
                return new Holder();
              },
            },
          ),
          attr('value', idlType.DOMString, {
            overrideCapturesIncumbent: flag,
            overrideGet({ relevant, callee, incumbent }) { received.push({ relevant, callee, incumbent }); return 'read'; },
            overrideSet(environments, value) { expect(value).toBe('converted'); received.push(environments); },
          }),
          staticOp('inspect', idlType.undefined,
            [],
            {
              overrideCapturesIncumbent: flag,
              overrideInvoke(environments) { received.push(environments); },
            },
          ),
        ],
      }),
      defineNamespace({
        name: 'Inspector', exposed: '*', members: [
          op('inspect', idlType.undefined,
            [],
            {
              overrideCapturesIncumbent: flag,
              overrideInvoke(environments) { received.push(environments); },
            },
          ),
        ],
      }),
    ], { getIncumbentEnvironment: lookup });
    const realm = new TestRealm();
    const create = vi.spyOn(realm, 'createFunction');
    const { globalObject, context } = installTestBindings(world, realm);
    const Constructor = Reflect.get(globalObject, 'Holder') as {
      new(label: unknown): { value: unknown; };
      inspect(): void;
    };
    const inspector = Reflect.get(globalObject, 'Inspector') as { inspect(): void; };
    const convert = vi.fn(() => 'converted');
    const object = new Constructor({ toString: convert });
    expect(object.value).toBe('read');
    object.value = { toString: convert };
    Constructor.inspect();
    inspector.inspect();
    expect(convert).toHaveBeenCalledTimes(2);
    expect(received).toEqual(Array.from({ length: 5 }, () => ({
      relevant: context.getEnvironment(), callee: context.getEnvironment(), incumbent: flag ? incumbent : undefined,
    })));
    expect(lookup).toHaveBeenCalledTimes(flag ? 5 : 0);
    expect(create.mock.calls.filter(([, options]) => options.captureIncumbent).map(([, options]) => options.name).sort())
      .toEqual(flag ? ['Holder', 'get value', 'inspect', 'inspect', 'set value'] : []);

    // A direct host invocation may have no incumbent even when capture was requested.
    incumbent = undefined;
    inspector.inspect();
    expect(received.at(-1)!.incumbent).toBeUndefined();
    lookup.mockClear();
    const error = new Error('conversion');
    expect(() => new Constructor({ toString() { throw error; } })).toThrow(error);
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([true, false, undefined])('honors an explicit capture flag without override callbacks (%s)', (flag) => {
    class Holder {
      value = 'initial';
      readonlyValue = 'readonly';
      read() { return this.value; }
    }
    const world = new BindingWorld([
      defineInterface({
        name: 'Holder', exposed: '*', implementation: impl(Holder), members: [
          ctor([], { overrideCapturesIncumbent: flag }),
          attr('value', idlType.DOMString, { overrideCapturesIncumbent: flag }),
          roAttr('readonlyValue', idlType.DOMString, {
            overrideCapturesIncumbent: flag, ...xattr('Replaceable'),
          }),
          op('read', idlType.DOMString, [], { overrideCapturesIncumbent: flag }),
        ],
      }),
    ]);
    const realm = new TestRealm();
    const create = vi.spyOn(realm, 'createFunction');
    const { globalObject } = installTestBindings(world, realm);
    const Constructor = Reflect.get(globalObject, 'Holder') as new() => Holder;
    const object = new Constructor();
    object.value = 'written';
    expect(object.read()).toBe('written');
    expect(object.readonlyValue).toBe('readonly');
    object.readonlyValue = 'replaced';
    expect(object.readonlyValue).toBe('replaced');
    expect(create.mock.calls.filter(([, options]) => options.captureIncumbent).map(([, options]) => options.name).sort())
      .toEqual(flag ? ['Holder', 'get readonlyValue', 'get value', 'read', 'set readonlyValue', 'set value'] : []);
  });

  it('follows nullable aliases, inherited attributes and multiple forwarding setters', () => {
    const incumbent = { realm: new TestRealm() };
    const received: unknown[] = [];
    class Destination {
      value = '';
      read() { return this.value; }
      write(value: string, env: unknown) { this.value = value; received.push(env); }
    }
    class Derived extends Destination {}
    class Middle { next = new Derived(); }
    class Outer { destination = new Middle(); }
    const world = new BindingWorld([
      defineInterface({
        name: 'Destination', exposed: '*', implementation: impl(Destination), members: [
          attr('value', idlType.DOMString, {
            overrideGet() { return (this as Destination).read(); },
            overrideCapturesIncumbent: true,
            overrideSet({ incumbent: incumbentEnv }, value) { (this as Destination).write(value as string, incumbentEnv); },
          }),
        ],
      }),
      defineInterface({ name: 'Derived', inherits: 'Destination', exposed: '*', implementation: impl(Derived), members: [] }),
      defineTypedef({ name: 'Target', type: nullable(reference('Derived')) }),
      defineInterface({
        name: 'Middle', exposed: '*', implementation: impl(Middle), members: [
          roAttr('next', reference('Target'), xattr(['PutForwards', 'value'])),
        ],
      }),
      defineInterface({
        name: 'Outer', exposed: '*', implementation: impl(Outer), members: [
          ctor(), roAttr('destination', reference('Middle'), xattr(['PutForwards', 'next'])),
        ],
      }),
    ], { getIncumbentEnvironment: () => incumbent });
    const realm = new TestRealm();
    const create = vi.spyOn(realm, 'createFunction');
    const { globalObject } = installTestBindings(world, realm);
    const Constructor = Reflect.get(globalObject, 'Outer') as new() => { destination: { next: { value: string; }; }; };
    const object = new Constructor();
    const destination = object.destination;
    const read = vi.fn(() => destination);
    // PutForwards must still perform author-observable Get, not jump to the implementation.
    Object.defineProperty(object, 'destination', { get: read });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Invoke the original setter with the shadowing receiver.
    const setter = Object.getOwnPropertyDescriptor(Constructor.prototype, 'destination')!.set!;
    const convert = vi.fn(() => 'forwarded');
    Reflect.apply(setter, object, [{ toString: convert }]);
    expect(destination.next.value).toBe('forwarded');
    expect(read).toHaveBeenCalledOnce();
    expect(convert).toHaveBeenCalledOnce();
    expect(received).toEqual([incumbent]);
    expect(create.mock.calls.filter(([, options]) => options.captureIncumbent).map(([, options]) => options.name))
      .toEqual(['get value', 'set value', 'set next', 'set destination']);
  });

  it('includes a forwarding getter dependency when the destination setter needs no incumbent', () => {
    const incumbent = { realm: new TestRealm() };
    const received: unknown[] = [];
    class Destination { value = ''; }
    class Source {
      destination = new Destination();
      read(env: unknown) { received.push(env); return this.destination; }
    }
    const world = new BindingWorld([
      defineInterface({
        name: 'Destination', exposed: '*', implementation: impl(Destination),
        members: [attr('value', idlType.DOMString)],
      }),
      defineInterface({
        name: 'Source', exposed: '*', implementation: impl(Source), members: [
          ctor(), roAttr('destination', reference('Destination'), {
            overrideCapturesIncumbent: true,
            overrideGet({ incumbent: incumbentEnv }) { return (this as Source).read(incumbentEnv); },
            ...xattr(['PutForwards', 'value']),
          }),
        ],
      }),
    ], { getIncumbentEnvironment: () => incumbent });
    const realm = new TestRealm();
    const create = vi.spyOn(realm, 'createFunction');
    const { globalObject } = installTestBindings(world, realm);
    const Constructor = Reflect.get(globalObject, 'Source') as new() => { destination: { value: string; }; };
    const source = new Constructor();
    Reflect.set(source, 'destination', 'forwarded');
    expect(received).toEqual([incumbent]);
    expect(source.destination.value).toBe('forwarded');
    expect(create.mock.calls.filter(([, options]) => options.captureIncumbent).map(([, options]) => options.name))
      .toEqual(['get destination', 'set destination']);
  });

  it('captures for callback conversion and injected inputs while leaving ordinary members alone', () => {
    const incumbent = { realm: new TestRealm() };
    const lookup = vi.fn(() => incumbent);
    class Consumer {
      callback: unknown;
      take(value: unknown) { this.callback = value; }
      takeDictionary(value: unknown) { this.callback = value; }
      inspect(value: unknown) { this.callback = value; }
      read(_env: unknown) {}
      ordinary(_value: string, _env: unknown) {}
    }
    const world = new BindingWorld([
      defineCallbackFunction({ name: 'Callback', arguments: [], returns: idlType.undefined }),
      defineDictionary({ name: 'Options', members: [{ name: 'callback', type: reference('Callback') }] }),
      defineInterface({
        name: 'Consumer', exposed: '*', implementation: impl(Consumer), members: [
          ctor(), attr('callback', nullable(reference('Callback'))),
          op('take', idlType.undefined, [arg('callback', reference('Callback'))]),
          op('take', idlType.undefined, [arg('label', idlType.DOMString)]),
          op('takeDictionary', idlType.undefined, [arg('options', reference('Options'))]),
          op('inspect', idlType.undefined, [arg('options', idlType.object, cbDict('Options'))]),
          op('read', idlType.undefined,
            [], invokeWith(atArg(0, (_env, _methodEnv, incumbentEnv) => incumbentEnv)),
          ),
          op('ordinary', idlType.undefined,
            [arg('value', idlType.DOMString)], invokeWith(atArg(1, (_env, methodEnv) => methodEnv)),
          ),
        ],
      }),
    ], { getIncumbentEnvironment: lookup });
    const realm = new TestRealm();
    const create = vi.spyOn(realm, 'createFunction');
    const capture = vi.spyOn(realm.callbacks, 'captureEnvironment');
    const { globalObject } = installTestBindings(world, realm);
    const Constructor = Reflect.get(globalObject, 'Consumer') as new() => {
      callback: () => void;
      take(callback: () => void): void;
      takeDictionary(options: { callback: () => void; }): void;
      inspect(options: { callback: () => void; }): void;
      ordinary(value: string): void;
      read(): void;
    };
    const object = new Constructor();
    const callback = () => {};
    object.callback = callback;
    object.take(callback);
    object.takeDictionary({ callback });
    object.inspect({ callback });
    expect(capture).toHaveBeenCalledTimes(4);
    object.ordinary('ordinary');
    expect(lookup).not.toHaveBeenCalled();
    object.read();
    expect(lookup).toHaveBeenCalledOnce();
    expect(create.mock.calls.filter(([, options]) => options.captureIncumbent).map(([, options]) => options.name))
      .toEqual(['set callback', 'take', 'takeDictionary', 'inspect', 'read']);
  });
});
