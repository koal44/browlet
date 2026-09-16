import { describe, expect, it } from 'vitest';
import { Browlet } from '../../src/browlet/browlet';

describe('Browlet evaluation bridge', () => {
  it('evaluates source and functions in the page and awaits their results', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate('Promise.resolve(42)')).toBe(42);
    expect(await browlet.evaluate((value) => value + 1, 41)).toBe(42);
    expect(await browlet.evaluate(() => typeof process)).toBe('undefined');
    expect(await browlet.evaluate(() => new Promise<string>((resolve) => {
      setTimeout(() => resolve('timer'), 0);
    }))).toBe('timer');
  });

  it('copies arguments and results, preserving cycles and special primitives', async () => {
    const browlet = new Browlet({ route: () => '' });
    const value = { count: 1, self: null as unknown };
    value.self = value;
    const result = await browlet.evaluate((input) => {
      if (!(input instanceof Object)) throw new Error('Argument is not a page object');
      input.count++;
      return { input, values: [undefined, NaN, Infinity, -Infinity, -0, 3n] };
    }, value);
    expect(value.count).toBe(1);
    expect(result.input.count).toBe(2);
    expect(result.input.self).toBe(result.input);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result.values).toEqual([undefined, NaN, Infinity, -Infinity, -0, 3n]);
  });

  it('takes an argument snapshot before the command runs', async () => {
    const browlet = new Browlet({ route: () => '' });
    const input = { value: 'before' };
    const result = browlet.evaluate((arg) => arg.value, input);
    input.value = 'after';
    expect(await result).toBe('before');
  });

  it('serializes method shorthand and rejects functions without source', async () => {
    const browlet = new Browlet({ route: () => '' });
    const methods = {
      read(this: void, value: number) { return value + 1; },
      async readAsync(this: void, value: number) { return await Promise.resolve(value + 1); },
    };
    expect(await browlet.evaluate(methods.read, 41)).toBe(42);
    expect(await browlet.evaluate(methods.readAsync, 41)).toBe(42);
    await expect(browlet.evaluate(methods.read.bind(undefined), 41)).rejects.toThrow('cannot be serialized');
  });

  it('copies collection data and preserves repeated built-in values', async () => {
    const browlet = new Browlet({ route: () => '' });
    const date = new Date(123);
    const expression = /value/gi;
    const result = await browlet.evaluate((input) => ({
      date: input.date,
      sameDate: input.map.get('date') === input.date,
      sameExpression: input.set.has(input.expression),
      constructors: [input.date instanceof Date, input.map instanceof Map, input.set instanceof Set],
    }), { date, expression, map: new Map([['date', date]]), set: new Set([expression]) });
    expect(result).toEqual({ date, sameDate: true, sameExpression: true, constructors: [true, true, true] });
    expect(result.date).not.toBe(date);
  });

  it('copies own __proto__ keys without modifying recipient prototypes', async () => {
    const browlet = new Browlet({ route: () => '' });
    const result = await browlet.evaluate((value) => value, JSON.parse('{"__proto__":{"value":17}}') as object);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, '__proto__')).toBe(true);
    expect(Reflect.get(result, '__proto__')).toEqual({ value: 17 });
  });

  it('finishes unrelated Node work while the page awaits a host callback', async () => {
    const browlet = new Browlet({ route: () => '' });
    await browlet.exposeFunction('host', async () => {
      await Promise.resolve();
      return new Promise<string>((resolve) => { setImmediate(() => resolve('done')); });
    });
    expect(await browlet.evaluate(() => {
      const host = Reflect.get(globalThis, 'host') as () => Promise<string>;
      return host();
    })).toBe('done');
  });

  it('creates a page function and page Promise while the host receives copies', async () => {
    const browlet = new Browlet({ route: () => '' });
    let argument: { count: number; } | undefined;
    await browlet.exposeFunction('host', (value: { count: number; }) => {
      argument = value;
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
      value.count++;
      return Promise.resolve(value);
    });
    expect(await browlet.evaluate(async () => {
      const host = Reflect.get(globalThis, 'host') as (value: { count: number; }) => Promise<{ count: number; }>;
      const input = { count: 1 };
      const result = host(input);
      const promiseInPage = result instanceof Promise;
      const value = await result;
      return {
        promiseInPage, functionInPage: host instanceof Function,
        objectInPage: value instanceof Object, input: input.count, output: value.count,
      };
    })).toEqual({
      promiseInPage: true, functionInPage: true, objectInPage: true, input: 1, output: 2,
    });
    expect(argument?.count).toBe(2);
  });

  it.each(['fulfill', 'reject', 'throw'] as const)('delivers a host thenable %s without a manual checkpoint', async (outcome) => {
    const browlet = new Browlet({ route: () => '' });
    const calls: string[] = [];
    await browlet.exposeFunction('host', () => ({
      then(resolve: (value: string) => void, reject: (reason: unknown) => void) {
        calls.push('then');
        if (outcome === 'throw') throw new TypeError('host failure');
        if (outcome === 'reject') reject(new TypeError('host failure'));
        else resolve('host result');
        calls.push('finished');
      },
    }));
    const result = await browlet.evaluate(() => {
      const host = Reflect.get(globalThis, 'host') as () => Promise<string>;
      return host().then(
        (value) => value,
        (error: TypeError) => ({ name: error.name, message: error.message, inPage: error instanceof TypeError }),
      );
    });
    expect(result).toEqual(outcome === 'fulfill'
      ? 'host result' : { name: 'TypeError', message: 'host failure', inPage: true });
    expect(calls).toEqual(outcome === 'throw' ? ['then'] : ['then', 'finished']);
  });

  it('allows concurrent callback results to complete in their own order', async () => {
    const browlet = new Browlet({ route: () => '' });
    const first = Promise.withResolvers<string>();
    const second = Promise.withResolvers<string>();
    const started = Promise.withResolvers<void>();
    let calls = 0;
    await browlet.exposeFunction('host', (name: string) => {
      if (++calls === 2) started.resolve();
      return name === 'first' ? first.promise : second.promise;
    });
    const result = browlet.evaluate(async () => {
      const host = Reflect.get(globalThis, 'host') as (name: string) => Promise<string>;
      const order: string[] = [];
      await Promise.all([host('first').then((value) => order.push(value)), host('second').then((value) => order.push(value))]);
      return order;
    });
    await started.promise;
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    second.resolve('second');
    first.resolve('first');
    expect(await result).toEqual(['second', 'first']);
  });

  it('copies failures back to the host, including primitive rejection reasons', async () => {
    const browlet = new Browlet({ route: () => '' });
    await expect(browlet.evaluate(() => { throw new TypeError('page failure'); })).rejects.toBeInstanceOf(TypeError);
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Primitive rejection values must survive evaluation.
    await expect(browlet.evaluate(() => Promise.reject(undefined))).rejects.toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- Primitive thrown values must survive evaluation.
    await expect(browlet.evaluate(() => { throw 17; })).rejects.toBe(17);
  });

  it('copies exceptions thrown while reading result properties', async () => {
    const browlet = new Browlet({ route: () => '' });
    await expect(browlet.evaluate(() => ({ get value() { throw new TypeError('getter'); } })))
      .rejects.toBeInstanceOf(TypeError);
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- An uncopyable thrown value must become a host TypeError.
    await expect(browlet.evaluate(() => ({ get value() { throw () => 1; } })))
      .rejects.toBeInstanceOf(TypeError);
  });

  it('copies error causes and normalizes error text instead of sharing objects', async () => {
    const browlet = new Browlet({ route: () => '' });
    const failure = new TypeError('host failure', { cause: { detail: 17 } });
    Reflect.set(failure, 'stack', { detail: 'host stack' });
    await browlet.exposeFunction('host', () => { throw failure; });
    expect(await browlet.evaluate(() => {
      const host = Reflect.get(globalThis, 'host') as () => Promise<never>;
      return host().catch((error: TypeError) => ({
        inPage: error instanceof TypeError,
        causeInPage: error.cause instanceof Object,
        cause: error.cause,
        stackType: typeof error.stack,
      }));
    })).toEqual({ inPage: true, causeInPage: true, cause: { detail: 17 }, stackType: 'string' });
  });

  it('rejects values that need a live object handle', async () => {
    const browlet = new Browlet({ route: () => '' });
    await expect(browlet.evaluate(() => document)).rejects.toThrow('live objects require handles');
    await expect(browlet.evaluate(() => () => 1)).rejects.toThrow('Functions and proxies');
    await expect(browlet.evaluate((value) => value, () => 1)).rejects.toThrow('Functions and proxies');
  });

  it('does not carry closures into the page', async () => {
    const browlet = new Browlet({ route: () => '' });
    const hostOnly = 'private';
    await expect(browlet.evaluate(() => hostOnly)).rejects.toThrow('hostOnly is not defined');
  });

  it('rejects pending evaluation on navigation and installs callbacks in the new page', async () => {
    const browlet = new Browlet({ route: () => '' });
    const started = Promise.withResolvers<void>();
    const pending = Promise.withResolvers<string>();
    await browlet.exposeFunction('host', () => { started.resolve(); return pending.promise; });
    const result = browlet.evaluate(() => {
      const host = Reflect.get(globalThis, 'host') as () => Promise<string>;
      return host();
    });
    const rejected = expect(result).rejects.toThrow('context was destroyed');
    await started.promise;
    await browlet.navigate('https://example.test/next');
    await rejected;
    pending.resolve('finished');
    expect(await browlet.evaluate(() => {
      const host = Reflect.get(globalThis, 'host') as () => Promise<string>;
      return host();
    })).toBe('finished');
  });

  it('rejects duplicate callback names', async () => {
    const browlet = new Browlet({ route: () => '' });
    await browlet.exposeFunction('host', () => 1);
    await expect(browlet.exposeFunction('host', () => 2)).rejects.toThrow('already exposed');
    expect(await browlet.evaluate(() => {
      const host = Reflect.get(globalThis, 'host') as () => Promise<number>;
      return host();
    })).toBe(1);
  });

  it('discards callback delivery if copying its result navigates the page', async () => {
    const browlet = new Browlet({ route: () => '' });
    let navigation: Promise<WindowProxy> | undefined;
    await browlet.exposeFunction('host', () => ({
      get value() { navigation = browlet.navigate('https://example.test/next'); return 17; },
    }));
    await expect(browlet.evaluate(() => {
      const host = Reflect.get(globalThis, 'host') as () => Promise<{ value: number; }>;
      return host();
    })).rejects.toThrow('context was destroyed');
    await navigation;
    await new Promise<void>((resolve) => { setImmediate(resolve); });
  });
});
