import { describe, expect } from 'vitest';
import type { AsyncIterator } from '../../../src/infra/iteration';
import {
  arg, asyncSequence, ctor, defineCallbackFunction, defineDictionary, defineInterface, dictMember, frozenArray,
  idlType, impl, nullable, onError, op, promise, reference, sequence, union,
} from '../../../src/web-idl/core/index';
import { BindingWorld } from '../../../src/web-idl/binding/world';
import { installTestBindings } from '../../support/web-idl-binding';
import { itPassesWith } from '../../test-runtime';

describe('Web IDL undetectable callable objects', () => {
  function setup() {
    const result = {};
    const calls: unknown[][] = [];
    class CallableImpl {}
    class ConsumerImpl {
      echo(value: unknown): unknown { return value; }
      echoNullable(value: object | null): object | null { return value; }
      echoInterface(value: CallableImpl): CallableImpl { return value; }
      echoInterfaceUnion(value: CallableImpl | string): CallableImpl | string { return value; }
      echoBoolean(value: boolean): boolean { return value; }
      echoString(value: string): string { return value; }
      echoDictionary(value: { payload: object; }): object { return value.payload; }
      echoSequence(value: object[]): object { return value[0]!; }
      readSequence(value: object[] | string): object | string { return typeof value === 'string' ? value : value[0]!; }
      readAsyncSequence(value: AsyncIterator<object> | string): unknown {
        return typeof value === 'string' ? value : value.next().then((entry) => entry, undefined, idlType.any);
      }
      invoke(value: (() => object) | string): object | string {
        return typeof value === 'string' ? value : value();
      }
      invokeUnion(value: (() => object) | string): object | string { return this.invoke(value); }
      overloaded(value: (() => object) | string): object | string { return this.invoke(value); }
      unwrap(value: CallableImpl): boolean { return value instanceof CallableImpl; }
    }
    const callable = defineInterface({
      name: 'Callable', exposed: '*',
      implementation: impl(CallableImpl), members: [],
    });
    const callback = defineCallbackFunction({ name: 'Callback', returns: idlType.object, arguments: [] });
    const dictionary = defineDictionary({
      name: 'Payload', members: [dictMember('payload', idlType.object, { required: true })],
    });
    const consumer = defineInterface({
      name: 'Consumer', exposed: '*', implementation: impl(ConsumerImpl),
      members: [
        ctor(),
        op('echo', union(idlType.object, idlType.DOMString),
          [arg('value', union(idlType.object, idlType.DOMString))],
        ),
        op('echoNullable', nullable(idlType.object), [arg('value', nullable(idlType.object))]),
        op('echoInterface', reference('Callable'), [arg('value', reference('Callable'))]),
        op('echoInterfaceUnion', union(reference('Callable'), idlType.DOMString),
          [arg('value', union(reference('Callable'), idlType.DOMString))],
        ),
        op('echoBoolean', idlType.boolean, [arg('value', idlType.boolean)]),
        op('echoString', idlType.DOMString, [arg('value', idlType.DOMString)]),
        op('echoDictionary', idlType.object, [arg('value', reference('Payload'))]),
        op('echoSequence', idlType.object, [arg('value', sequence(idlType.object))]),
        op('readSequence', idlType.object, [arg('value', sequence(idlType.object))]),
        op('readSequence', idlType.DOMString, [arg('value', idlType.DOMString)]),
        op('readAsyncSequence', promise(idlType.any), [arg('value', asyncSequence(idlType.object))]),
        op('readAsyncSequence', idlType.DOMString, [arg('value', idlType.DOMString)]),
        op('invoke', idlType.object, [arg('value', reference('Callback'), onError('rethrow'))]),
        op('invokeUnion', union(idlType.object, idlType.DOMString),
          [arg('value', union(reference('Callback'), idlType.DOMString), onError('rethrow'))],
        ),
        op('overloaded', idlType.object,
          [arg('value', reference('Callback'), onError('rethrow'))],
        ),
        op('overloaded', idlType.DOMString, [arg('value', idlType.DOMString)]),
        op('unwrap', idlType.boolean, [arg('value', idlType.object, { implClasses: [CallableImpl] })]),
      ],
    });
    const { context, globalObject } = installTestBindings(new BindingWorld([callable, callback, dictionary, consumer]));
    // These conversion tests need arbitrary native call steps, independently of document.all's lookup rules.
    const value = context.realm.createHTMLDDA((...args: unknown[]) => { calls.push(args); return result; });
    const record = context.associate(CallableImpl, new CallableImpl());
    Object.setPrototypeOf(value, context.getPlatformObjectPrototype(record.assembled));
    record.attachPlatformObject(value);
    const Consumer = Reflect.get(globalObject, 'Consumer') as new() => {
      echo(value: object): object;
      echoNullable(value: object): object;
      echoInterface(value: object): object;
      echoInterfaceUnion(value: object): object;
      echoBoolean(value: object): boolean;
      echoString(value: object): string;
      echoDictionary(value: { payload: object; }): object;
      echoSequence(value: object[]): object;
      readSequence(value: object): object;
      readAsyncSequence(value: object): Promise<object>;
      invoke(value: object): object;
      invokeUnion(value: object): object;
      overloaded(value: object): object;
      unwrap(value: object): boolean;
    };
    return { value, consumer: new Consumer(), result, calls, context };
  }

  itPassesWith('htmlDDA')('retains object, nullable, union and interface values instead of treating them as undefined', () => {
    const { value, consumer } = setup();
    expect(consumer.echo(value)).toBe(value);
    expect(consumer.echoNullable(value)).toBe(value);
    expect(consumer.echoInterface(value)).toBe(value);
    expect(consumer.echoInterfaceUnion(value)).toBe(value);
  });

  itPassesWith('htmlDDA').each(['invoke', 'invokeUnion', 'overloaded'] as const)('accepts a callable object through %s', (method) => {
    const { value, consumer, result } = setup();
    expect(consumer[method](value)).toBe(result);
  });

  itPassesWith('htmlDDA')('unwraps explicitly declared implementation arguments', () => {
    const { value, consumer } = setup();
    expect(consumer.unwrap(value)).toBe(true);
  });

  itPassesWith('htmlDDA')('preserves nested values, callback results, and native Boolean conversion', () => {
    const { value, consumer } = setup();
    expect(consumer.echoDictionary({ payload: value })).toBe(value);
    expect(consumer.echoSequence([value])).toBe(value);
    expect(consumer.invoke(() => value)).toBe(value);
    expect(consumer.echoBoolean(value)).toBe(false);
  });

  itPassesWith('htmlDDA')('treats undetectable objects as objects during author coercion', () => {
    const { value, consumer, context } = setup();
    Reflect.set(value, Symbol.toPrimitive, () => 'collection');
    expect(consumer.echoString(value)).toBe('collection');
    expect(() => consumer.echoString({ [Symbol.toPrimitive]: () => value }))
      .toThrow(context.realm.TypeError);
  });

  itPassesWith('htmlDDA').each(['iterator', 'next'] as const)('accepts an undetectable %s method during sequence conversion', async (method) => {
    const { value, consumer, result, context } = setup();
    const entry = {};
    const input = [entry];
    let done = false;
    if (method === 'iterator') {
      Reflect.set(result, 'next', () => {
        const iteration = { done, value: entry };
        done = true;
        return iteration;
      });
      Reflect.set(input, Symbol.iterator, value);
    } else {
      Object.defineProperty(result, 'done', { get() { const previous = done; done = true; return previous; } });
      Reflect.set(result, 'value', entry);
      Reflect.set(input, Symbol.iterator, () => ({ next: value }));
    }
    expect(consumer.echoSequence(input)).toBe(entry);
    for (const type of [frozenArray(idlType.object), union(sequence(idlType.object), idlType.DOMString),
      union(frozenArray(idlType.object), idlType.DOMString)]) {
      done = false;
      expect(context.jsToImpl(input, type)).toEqual([entry]);
    }
    for (const mode of ['sync', 'async']) {
      if (mode === 'async') {
        Reflect.set(input, Symbol.asyncIterator, Reflect.get(input, Symbol.iterator));
        Reflect.set(input, Symbol.iterator, undefined);
      }
      for (const type of [asyncSequence(idlType.object), union(asyncSequence(idlType.object), idlType.DOMString)]) {
        done = false;
        const iterator = context.jsToImpl(input, type) as AsyncIterator<object>;
        const first = Promise.withResolvers<unknown>();
        iterator.next().observe(first.resolve, first.reject);
        await expect(first.promise).resolves.toBe(entry);
      }
    }
  });

  itPassesWith('htmlDDA')('captures a falsy iterator method once when selecting a sequence overload', () => {
    const { value, consumer, result } = setup();
    const entry = {};
    let reads = 0;
    let done = false;
    Reflect.set(result, 'next', () => {
      const iteration = { done, value: entry };
      done = true;
      return iteration;
    });
    const input = { get [Symbol.iterator]() { reads++; return value; } };

    expect(consumer.readSequence(input)).toBe(entry);
    expect(reads).toBe(1);
  });

  itPassesWith('htmlDDA').each(['sync', 'async'] as const)(
    'selects an async-sequence overload with a falsy %s iterator method', async (kind) => {
      const { value, consumer, result } = setup();
      const entry = {};
      let reads = 0;
      Reflect.set(result, 'next', () => kind === 'async'
        ? Promise.resolve({ done: false, value: entry }) : { done: false, value: entry });
      const input = {
        get [Symbol.asyncIterator]() { if (kind === 'sync') return undefined; reads++; return value; },
        get [Symbol.iterator]() {
          if (kind === 'async') throw new Error('An existing async iterator must prevent synchronous fallback');
          reads++;
          return value;
        },
      };

      await expect(consumer.readAsyncSequence(input)).resolves.toBe(entry);
      expect(reads).toBe(1);
    },
  );

  itPassesWith('htmlDDA').each(['sync', 'async'] as const)(
    'calls a falsy return method when closing its %s iterator', async (kind) => {
      const { value, result, calls, context } = setup();
      Reflect.set(result, 'done', true);
      const input = {
        [kind === 'sync' ? Symbol.iterator : Symbol.asyncIterator]: () => ({
          next: () => ({ done: true }), return: value,
        }),
      };
      const iterator: AsyncIterator<object> = context.jsToImpl(input, asyncSequence(idlType.object));
      const closed = Promise.withResolvers<void>();
      iterator.return('stop').observe(closed.resolve, closed.reject);

      await expect(closed.promise).resolves.toBeUndefined();
      expect(calls).toEqual([['stop']]);
    },
  );

  itPassesWith('htmlDDA')('projects an implementation-supplied native callable as a callback or callback union', () => {
    const { value, context } = setup();
    expect(context.implToJS(value, reference('Callback'))).toBe(value);
    expect(context.implToJS(value, union(reference('Callback'), idlType.DOMString))).toBe(value);
  });
});
