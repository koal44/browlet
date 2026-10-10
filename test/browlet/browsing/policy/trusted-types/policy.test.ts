import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../../src/browlet/browlet';
import type { Window as PlatformWindow } from '../../../../../src/browlet/platform';

describe('Trusted Types policies and values', () => {
  it('creates the three trusted brands and stringifies their immutable policy results', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const scope = globalThis as unknown as PlatformWindow;
      const factory = scope.trustedTypes;
      const policy = factory.createPolicy('app', {
        createHTML: (input) => `<b>${input}</b>`,
        createScript: (input) => `run(${input})`,
        createScriptURL: (input) => `/scripts/${input}`,
      });
      const values = [policy.createHTML('text'), policy.createScript('1'), policy.createScriptURL('app.js')];
      const html = values[0]!;
      Object.defineProperty(html, 'data', { value: 'forged' });
      Object.defineProperty(html, 'toString', { value: () => 'overridden' });
      return {
        name: policy.name,
        brands: values.map((value) => [factory.isHTML(value), factory.isScript(value), factory.isScriptURL(value)]),
        strings: values.map((value) => value.toJSON()),
        original: scope.TrustedHTML.prototype.toString.call(html),
        json: JSON.stringify(values),
        tags: values.map((value) => Object.prototype.toString.call(value)),
      };
    })).toEqual({
      name: 'app', brands: [[true, false, false], [false, true, false], [false, false, true]],
      strings: ['<b>text</b>', 'run(1)', '/scripts/app.js'], original: '<b>text</b>',
      json: '["<b>text</b>","run(1)","/scripts/app.js"]',
      tags: ['[object TrustedHTML]', '[object TrustedScript]', '[object TrustedScriptURL]'],
    });
  });

  it('converts the name before dictionary getters and snapshots callbacks in dictionary order', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const { trustedTypes } = globalThis as unknown as PlatformWindow;
      const calls: string[] = [];
      const options = {
        get createScriptURL() { calls.push('URL'); return (value: string) => value; },
        get createHTML() { calls.push('HTML'); return (value: string) => `first:${value}`; },
        get createScript() { calls.push('script'); return (value: string) => value; },
      };
      const name = { toString() { calls.push('name'); return 'ordered'; } };
      const policy = trustedTypes.createPolicy(name as unknown as string, options);
      Object.defineProperty(options, 'createHTML', { value: () => 'second' });
      return [calls, policy.name, String(policy.createHTML('input'))];
    })).toEqual([['name', 'HTML', 'script', 'URL'], 'ordered', 'first:input']);
  });

  it('passes the converted input and untouched extra arguments with undefined callback this', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      'use strict';
      const { trustedTypes } = globalThis as unknown as PlatformWindow;
      const marker = {};
      let received: unknown[] = [];
      const policy = trustedTypes.createPolicy('arguments', {
        createHTML: function(this: unknown, input, ...args) {
          received = [this === undefined, input, args.length, args[0] === marker, args[1]];
          return { toString: () => 'converted output' } as unknown as string;
        },
      });
      const value = policy.createHTML({ toString: () => 'converted input' } as unknown as string, marker, 7);
      return [received, String(value)];
    })).toEqual([[true, 'converted input', 2, true, 7], 'converted output']);
  });

  it('uses empty strings for null or undefined callback results and USVString only for URL output', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const { trustedTypes } = globalThis as unknown as PlatformWindow;
      const empty = trustedTypes.createPolicy('empty', {
        createHTML: () => null, createScript: () => undefined as unknown as null, createScriptURL: () => null,
      });
      const inputs: string[] = [];
      const policy = trustedTypes.createPolicy('strings', {
        createHTML: (value) => value,
        createScript: (value) => value,
        createScriptURL: (value) => { inputs.push(value); return value; },
      });
      return [
        String(empty.createHTML('x')), String(empty.createScript('x')), String(empty.createScriptURL('x')),
        policy.createHTML('\ud800').toJSON(), policy.createScript('\ud800').toJSON(),
        policy.createScriptURL('\ud800').toJSON(), inputs,
      ];
    })).toEqual(['', '', '', '\ud800', '\ud800', '\ufffd', ['\ud800']]);
  });

  it('keeps callback throws and output-coercion throws unchanged', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const { trustedTypes } = globalThis as unknown as PlatformWindow;
      const marker = {};
      const policy = trustedTypes.createPolicy('throws', {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Author callbacks may throw arbitrary values.
        createHTML: () => { throw marker; },
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Coercion must preserve arbitrary thrown values too.
        createScript: () => ({ toString() { throw marker; } }) as unknown as string,
        createScriptURL: () => Symbol('no string') as unknown as string,
      });
      const results: boolean[] = [];
      try { policy.createHTML('x'); } catch (error) { results.push(error === marker); }
      try { policy.createScript('x'); } catch (error) { results.push(error === marker); }
      try { policy.createScriptURL('x'); } catch (error) { results.push(error instanceof TypeError); }
      return results;
    })).toEqual([true, true, true]);
  });

  it('rejects missing/non-callable callbacks, missing required inputs, and author construction', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const scope = globalThis as unknown as PlatformWindow;
      const policy = scope.trustedTypes.createPolicy('empty');
      const operations = [
        () => policy.createHTML('x'), () => policy.createScript('x'), () => policy.createScriptURL('x'),
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Deliberately omit the required argument.
        () => { Reflect.apply(policy.createHTML, policy, []); },
        () => scope.trustedTypes.createPolicy('bad', { createHTML: null as never }),
        () => scope.trustedTypes.createPolicy('bad', { createHTML: 7 as never }),
        ...[scope.TrustedHTML, scope.TrustedScript, scope.TrustedScriptURL,
          scope.TrustedTypePolicy, scope.TrustedTypePolicyFactory].map((constructor) => () =>
          Reflect.construct(constructor as unknown as new () => object, [])),
      ];
      return operations.map((operation) => {
        try { operation(); return false; } catch (error) { return error instanceof TypeError; }
      });
    })).toEqual(Array<boolean>(11).fill(true));
  });
});
