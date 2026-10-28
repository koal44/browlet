import { describe, expect, it } from 'vitest';

import { arg, attr, defineInterface, idlType, impl, op, roAttr } from '../../../src/web-idl/core/index';
import { BindingWorld } from '../../../src/web-idl/binding/world';
import { TestRealm } from '../../support/web-idl-realm';

describe('fresh Web IDL member functions', () => {
  it('reuses declared inherited behavior without reading modified platform properties', () => {
    class BaseImpl {
      amount = 2;
      get doubled(): number { return this.amount * 2; }
      scale(factor: number): number { return this.amount * factor; }
    }
    class DerivedImpl extends BaseImpl {}
    const world = new BindingWorld([
      defineInterface({
        name: 'Base', implementation: impl(BaseImpl),
        members: [
          attr('amount', idlType.long),
          roAttr('doubled', idlType.long),
          op('scale', idlType.long, [arg('factor', idlType.long)]),
        ],
      }),
      defineInterface({ name: 'Derived', inherits: 'Base', implementation: impl(DerivedImpl), members: [] }),
    ]);
    const methodRealm = new TestRealm();
    const receiverRealm = new TestRealm();
    const context = world.register(methodRealm, (context) => ({ realm: context.realm }));
    const receiverContext = world.register(receiverRealm, (context) => ({ realm: context.realm }));
    const receiver = receiverContext.project(DerivedImpl, new DerivedImpl());
    const methodOwner = context.project(DerivedImpl, new DerivedImpl());
    const original: unknown = Reflect.get(methodOwner, 'scale');
    const prototype = Reflect.getPrototypeOf(Reflect.getPrototypeOf(methodOwner)!)!;
    Reflect.set(prototype, 'scale', () => { throw new Error('Author replacement must not run'); });

    const operation = context.createMemberFunction('Derived', 'scale', 'method')!;
    const getter = context.createMemberFunction('Derived', 'amount', 'getter')!;
    const setter = context.createMemberFunction('Derived', 'amount', 'setter')!;
    expect(operation).not.toBe(original);
    expect(operation).not.toBe(context.createMemberFunction('Derived', 'scale', 'method'));
    expect(operation).toBeInstanceOf(methodRealm.Function);
    expect(operation.name).toBe('scale');
    expect(operation.length).toBe(1);
    expect(Reflect.apply(operation, receiver, ['3'])).toBe(6);
    Reflect.apply(setter, receiver, ['8.5']);
    expect(Reflect.apply(getter, receiver, [])).toBe(8);
    expect(Reflect.apply(operation, receiver, [3])).toBe(24);
    expect(() => { Reflect.apply(operation, receiver, [Symbol()]); }).toThrow(methodRealm.TypeError);
    expect(() => { Reflect.apply(operation, {}, [3]); }).toThrow(methodRealm.TypeError);
    expect(context.createMemberFunction('Derived', 'doubled', 'setter')).toBeUndefined();
    expect(context.createMemberFunction('Derived', 'missing', 'getter')).toBeUndefined();
  });
});
