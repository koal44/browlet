import { describe, expect, it } from 'vitest';

import { endOfIteration, TypeError as InternalTypeError } from '../../../src/infra/index';
import {
  arg, asyncIter, atArg, attr, BindingWorld, ctor, defineInterface, idlType, impl, invokeWith, iter, op,
  reference, serializeDefinitions, staticOp, stringifier,
} from '../../../src/web-idl/index';
import { DefinitionAssembly, validateDefinitions } from '../../../src/web-idl/assembly/index';
import { TestRealm } from '../../support/web-idl-realm';
import { validateImplementationMembers } from '../../support/web-idl-binding';

describe('Implementation arrays', () => {
  class QImpl {
    #text: string;
    initialized = false;
    constructor(text: string, public dependency: object) { this.#text = text; }
    get text(): string { return `q:${this.#text}`; }
    set text(value: string) { this.#text = value; }
    quote(): string { return this.#text; }
    append(value: string): void { this.#text += value; }
    self(): this { return this; }
  }
  class BlockQuoteImpl {
    #text: string;
    initialized = false;
    constructor(text: string, public dependency: object) { this.#text = text; }
    get text(): string { return `blockquote:${this.#text}`; }
    set text(value: string) { this.#text = value; }
    quote(): string { return this.#text.toUpperCase(); }
    append(value: string): void { this.#text += value; }
    self(): this { return this; }
  }
  const qDependency = {};
  const blockQuoteDependency = {};
  const implementations = [
    impl(QImpl, {
      constructWith: [atArg(1, () => qDependency)],
      initializeImplementation(_ctx, value) { value.initialized = true; },
    }),
    impl(BlockQuoteImpl, {
      constructWith: [atArg(1, () => blockQuoteDependency)],
      initializeImplementation(_ctx, value) { value.initialized = true; },
    }),
  ];
  const definition = defineInterface({
    name: 'Quote', exposed: '*',
    implementation: implementations,
    members: [
      attr('text', idlType.DOMString),
      op('quote', idlType.DOMString),
      op('append', idlType.undefined, [arg('value', idlType.DOMString)]),
      op('self', reference(implementations)),
    ],
  });

  it('associates both classes with one interface without choosing a primary class', () => {
    expect(() => validateDefinitions([definition])).not.toThrow();
    const assembly = new DefinitionAssembly([definition]);
    expect(assembly.interfaces.byImplClass.get(QImpl)).toBe(assembly.interfaces.get('Quote'));
    expect(assembly.interfaces.byImplClass.get(BlockQuoteImpl)).toBe(assembly.interfaces.get('Quote'));
    expect([...assembly.interfaces.values()]).toHaveLength(1);
    expect(() => assembly.getIDLType(reference(QImpl))).toThrow('No interface declares');
    expect(assembly.getIDLType(reference(implementations))).toMatchObject({ assembled: assembly.interfaces.get('Quote') });
    expect(() => assembly.getIDLType(reference(implementations.slice(0, 1)))).toThrow('No interface declares');
    expect(serializeDefinitions([definition])).toContain('Quote self()');
    for (const { implClass } of implementations) validateImplementationMembers(definition, new implClass('text', {}));
  });

  it('constructs and converts either class through the same realm-owned interface', () => {
    const world = new BindingWorld([definition]);
    const context = world.register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
    context.install(context.realm.globalObject);
    const q = context.construct(QImpl, ['first']);
    const blockquote = context.construct(BlockQuoteImpl, ['second']);
    expect(q.dependency).toBe(qDependency);
    expect(blockquote.dependency).toBe(blockQuoteDependency);
    expect(q.initialized).toBe(true);
    expect(blockquote.initialized).toBe(true);
    const first = context.implToJS(q, reference(implementations)) as object;
    const second = context.implToJS(blockquote, reference(implementations)) as object;
    expect(Object.getPrototypeOf(first)).toBe(Object.getPrototypeOf(second));
    expect(context.jsToImpl(first, reference(implementations))).toBe(q);
    expect(context.jsToImpl(second, reference(implementations))).toBe(blockquote);
  });

  it('retains typed references to a declared base that covers every implementation', () => {
    class BaseImpl { value = 'base'; }
    class FirstImpl extends BaseImpl { override value = 'first'; }
    class SecondImpl extends BaseImpl { override value = 'second'; }
    const definitions = [defineInterface({
      name: 'Base', exposed: '*',
      implementation: [impl(FirstImpl), impl(BaseImpl), impl(SecondImpl)],
      members: [
        attr('value', idlType.DOMString),
        op('self', reference(BaseImpl),
          [],
          { invoke() { return this; } },
        ),
      ],
    })];
    const world = new BindingWorld(definitions);
    const context = world.register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
    for (const Constructor of [BaseImpl, FirstImpl, SecondImpl]) {
      const implementation = context.construct(Constructor);
      const platform = context.implToJS(implementation, reference(BaseImpl)) as BaseImpl & { self(): object; };
      expect(platform.value).toBe(implementation.value);
      expect(platform.self()).toBe(platform);
      expect(context.jsToImpl(platform, reference(BaseImpl))).toBe(implementation);
    }
    expect(serializeDefinitions(definitions)).toContain('Base self()');
    const assembly = new DefinitionAssembly(definitions);
    expect(() => assembly.getIDLType(reference(FirstImpl))).toThrow('No interface declares');
  });

  it('invokes each implementation\'s own getter and method, including its private state', () => {
    const world = new BindingWorld([definition]);
    const context = world.register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
    const first = context.implToJS(context.construct(QImpl, ['first']), reference(implementations)) as { text: string; quote(): string; };
    const second = context.implToJS(context.construct(BlockQuoteImpl, ['second']), reference(implementations)) as { text: string; quote(): string; };
    expect(first.text).toBe('q:first');
    expect(second.text).toBe('blockquote:second');
    expect(first.quote()).toBe('first');
    expect(second.quote()).toBe('SECOND');
  });

  it('converts setters and arguments before reaching either implementation', () => {
    const world = new BindingWorld([definition]);
    const context = world.register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
    for (const Constructor of [QImpl, BlockQuoteImpl]) {
      const implementation = context.construct<QImpl | BlockQuoteImpl>(Constructor, ['initial']);
      const platform = context.implToJS(implementation, reference(implementations)) as Quote;
      let conversions = 0;
      const value = { toString() { conversions++; return 'converted'; } };
      Reflect.set(platform, 'text', value);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Apply with the platform receiver to exercise argument conversion.
      Reflect.apply(platform.append, platform, [value]);
      expect(implementation.text).toBe(`${Constructor === QImpl ? 'q' : 'blockquote'}:convertedconverted`);
      expect(conversions).toBe(2);
    }
  });

  it('preserves the receiver realm and identity when members are borrowed', () => {
    const world = new BindingWorld([definition]);
    const first = world.register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
    const second = world.register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
    const q = first.implToJS(first.construct(QImpl, ['first']), reference(implementations)) as Quote;
    const block = second.implToJS(second.construct(BlockQuoteImpl, ['second']), reference(implementations)) as Quote;
    expect(Object.getPrototypeOf(q) === Object.getPrototypeOf(block)).toBe(false);
    expect(q.quote.call(block)).toBe('SECOND');
    expect(q.self.call(block) === block).toBe(true);
    expect(world.getRealm(block)).toBe(second.realm);
    expect(() => q.quote.call({})).toThrow(first.realm.intrinsics.typeError);
    // Lookup failures still cross the invoking member's exception boundary.
    Object.defineProperty(second.getObjectRecord(block)!.implInst, 'quote', {
      get() { throw new InternalTypeError('implementation lookup failed'); },
    });
    expect(() => q.quote.call(block)).toThrow(first.realm.intrinsics.typeError);
  });

  it('looks up the method after argument conversion and dependency injection', () => {
    const order: string[] = [];
    const world = new BindingWorld([{
      ...definition,
      members: [op('append', idlType.undefined,
        [arg('value', idlType.DOMString)],
        invokeWith(atArg(1, () => { order.push('inject'); return null; })),
      )],
    }]);
    const context = world.register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
    for (const Constructor of [QImpl, BlockQuoteImpl]) {
      const implementation = context.construct<QImpl | BlockQuoteImpl>(Constructor, ['initial']);
      const platform = context.implToJS(implementation, reference(implementations)) as Quote;
      Object.defineProperty(implementation, 'append', {
        get() {
          order.push('lookup');
          return function(this: QImpl | BlockQuoteImpl, value: string, dependency: unknown) {
            expect(this).toBe(implementation);
            expect(value).toBe('converted');
            expect(dependency).toBe(null);
            order.push('call');
          };
        },
      });
      const value = { toString() { order.push('convert'); return 'converted'; } };
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise conversion through the projected method.
      Reflect.apply(platform.append, platform, [value]);
      expect(order).toEqual(['convert', 'inject', 'lookup', 'call']);
      order.length = 0;
    }
  });

  it('uses receiver overrides and permits explicit bindings to select the base algorithm', () => {
    class BaseImpl {
      describe(): string { return 'base'; }
    }
    class FirstImpl extends BaseImpl {
      override describe(): string { return 'first'; }
    }
    class SecondImpl extends BaseImpl {
      override describe(): string { return 'second'; }
    }
    class SpecializedImpl extends FirstImpl {
      override describe(): string { return 'specialized'; }
    }
    const world = new BindingWorld([
      defineInterface({
        name: 'Base', exposed: '*', implementation: impl(BaseImpl),
        members: [op('describe', idlType.DOMString,
          [],
          { invoke() { return BaseImpl.prototype.describe.call(this); } },
        )],
      }),
      defineInterface({
        name: 'Derived', exposed: '*', inherits: 'Base',
        implementation: [impl(FirstImpl), impl(SecondImpl)],
        members: [op('describe', idlType.DOMString)],
      }),
    ]);
    const context = world.register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
    const implementation = context.construct(SpecializedImpl);
    const platform = context.implToJS(implementation, reference('Derived')) as BaseImpl;
    const base = context.implToJS(context.construct(BaseImpl), reference(BaseImpl)) as BaseImpl;
    expect(platform.describe()).toBe('specialized');
    expect(base.describe.call(platform)).toBe('base');
    implementation.describe = () => 'replaced';
    expect(platform.describe()).toBe('replaced');
  });

  it('requires explicit construction and supports a shared static binding', () => {
    const world = new BindingWorld([{
      ...definition,
      members: [
        ...definition.members,
        ctor(
          [arg('block', idlType.boolean)],
          { construct(ctx, block) { return ctx.construct<QImpl | BlockQuoteImpl>(block ? BlockQuoteImpl : QImpl, ['created']); } },
        ),
        staticOp('label', idlType.DOMString, [], { invoke() { return 'shared'; } }),
      ],
    }]);
    const context = world.register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
    context.install(context.realm.globalObject);
    const Quote = Reflect.get(context.realm.globalObject, 'Quote') as {
      new(block: boolean): Quote;
      label(): string;
    };
    expect(new Quote(false).quote()).toBe('created');
    expect(new Quote(true).quote()).toBe('CREATED');
    expect(Quote.label()).toBe('shared');

    const ambiguous = new BindingWorld([{ ...definition, members: [ctor()] }]);
    expect(() => ambiguous.register(new TestRealm(), (ctx) => ({ realm: ctx.realm })))
      .toThrow('its constructor must select one explicitly');
  });

  it('reads each implementation\'s pair iterable and stringifier', () => {
    class FirstImpl {
      #entries: [string, number][] = [['first', 1]];
      getEntryList(): [string, number][] { return this.#entries; }
      toString(): string { return this.#entries[0]![0]; }
    }
    class SecondImpl {
      #entries: [string, number][] = [['second', 2]];
      getEntryList(): [string, number][] { return this.#entries; }
      toString(): string { return this.#entries[0]![0]; }
    }
    const world = new BindingWorld([defineInterface({
      name: 'Entries', exposed: '*', implementation: [impl(FirstImpl), impl(SecondImpl)],
      members: [iter(idlType.long, { key: idlType.DOMString }), stringifier()],
    })]);
    const context = world.register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
    for (const Constructor of [FirstImpl, SecondImpl]) {
      const implementation = context.construct<FirstImpl | SecondImpl>(Constructor);
      const platform = context.implToJS(implementation, reference('Entries')) as Iterable<[string, number]> & { toString(): string; };
      expect([...platform]).toEqual(implementation.getEntryList());
      expect(String(platform)).toBe(implementation.toString());
      for (const name of ['getEntryList', 'toString']) {
        Object.defineProperty(implementation, name, {
          get() { throw new InternalTypeError('implementation lookup failed'); },
        });
      }
      expect(() => [...platform]).toThrow(context.realm.intrinsics.typeError);
      expect(() => String(platform)).toThrow(context.realm.intrinsics.typeError);
    }
  });

  it('rejects empty arrays and duplicate concrete registrations', () => {
    expect(() => validateDefinitions([{ ...definition, implementation: [] }])).toThrow('has no implementations');
    expect(() => validateDefinitions([{ ...definition, implementation: [impl(QImpl), impl(QImpl)] }]))
      .toThrow('already registered');
  });

  it('creates asynchronous iterators using the concrete receiver', async () => {
    class FirstImpl {
      #value = 1;
      iterate() {
        let done = false;
        return { next: () => Promise.resolve(done ? endOfIteration : (done = true, this.#value)) };
      }
    }
    class SecondImpl {
      #value = 2;
      iterate() {
        let done = false;
        return { next: () => Promise.resolve(done ? endOfIteration : (done = true, this.#value)) };
      }
    }
    const world = new BindingWorld([defineInterface({
      name: 'Values', exposed: '*', implementation: [impl(FirstImpl), impl(SecondImpl)],
      members: [asyncIter(idlType.long, { create: 'iterate' })],
    })]);
    const context = world.register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
    const values: number[] = [];
    for (const Constructor of [FirstImpl, SecondImpl]) {
      const implementation = context.construct<FirstImpl | SecondImpl>(Constructor);
      const platform = context.implToJS(implementation, reference('Values')) as AsyncIterable<number>;
      for await (const value of platform) values.push(value);
    }
    expect(values).toEqual([1, 2]);
  });
});

type Quote = {
  text: string;
  quote(): string;
  append(value: string): void;
  self(): Quote;
};
