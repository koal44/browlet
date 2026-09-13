import { describe, expect, it, vi } from 'vitest';

import { getRealmBindings, getRelevantRealm } from '../../src/browlet/bindings';
import { Browlet } from '../../src/browlet/browlet';
import { FileImpl } from '../../src/file/index';
import { FormDataImpl } from '../../src/xhr/index';

describe('XMLHttpRequest FormData projection', () => {
  it('preserves entry order, duplicates, and replacement position', () => {
    const window = createWindow();
    const formData = construct(window, 'FormData');

    call(formData, 'append', ['first', '1']);
    call(formData, 'append', ['key', 'old']);
    call(formData, 'append', ['last', '3']);
    call(formData, 'append', ['key', 'duplicate']);

    expect(call(formData, 'get', ['key'])).toBe('old');
    expect(Array.from(call(formData, 'getAll', ['key']) as string[]))
      .toEqual(['old', 'duplicate']);
    expect(call(formData, 'has', ['key'])).toBe(true);

    call(formData, 'set', ['key', 'replacement']);
    expect(Array.from(formData as Iterable<[string, string]>)).toEqual([
      ['first', '1'],
      ['key', 'replacement'],
      ['last', '3'],
    ]);

    call(formData, 'delete', ['key']);
    expect(call(formData, 'get', ['key'])).toBeNull();
    expect(call(formData, 'has', ['key'])).toBe(false);
  });

  it('applies Web IDL string conversion before the entry-list algorithms', () => {
    const window = createWindow();
    const formData = construct(window, 'FormData');

    call(formData, 'append', ['key', undefined]);
    call(formData, 'append', ['key', null]);
    call(formData, 'append', ['bad\ud800name', 'bad\ud800value']);

    expect(Array.from(call(formData, 'getAll', ['key']) as string[]))
      .toEqual(['undefined', 'null']);
    expect(call(formData, 'get', ['bad\uFFFDname'])).toBe('bad\uFFFDvalue');

    const TypeError_ = requireFunction(window, 'TypeError');
    expect(() => call(formData, 'append', ['missing']))
      .toThrow(TypeError_);
  });

  it('normalizes Blob and File entries through HTML create-an-entry', async () => {
    const window = createWindow();
    const formData = construct(window, 'FormData');
    const blob = construct(window, 'Blob', [['blob bytes'], {
      type: 'text/plain',
    }]);
    const originalFile = construct(window, 'File', [
      ['file bytes'],
      'original.txt',
      { lastModified: 123, type: 'text/example' },
    ]);

    call(formData, 'append', ['blob', blob]);
    call(formData, 'append', ['file', originalFile]);
    call(formData, 'append', ['renamed', originalFile, 'renamed\ud800.txt']);

    const convertedBlob = call(formData, 'get', ['blob']) as object;
    const retainedFile = call(formData, 'get', ['file']) as object;
    const renamedFile = call(formData, 'get', ['renamed']) as object;

    expect(convertedBlob).not.toBe(blob);
    expect(convertedBlob).toBeInstanceOf(requireFunction(window, 'File'));
    expect(Reflect.get(convertedBlob, 'name')).toBe('blob');
    expect(Reflect.get(convertedBlob, 'type')).toBe('text/plain');
    await expect(call(convertedBlob, 'text')).resolves.toBe('blob bytes');

    expect(retainedFile).toBe(originalFile);
    expect(renamedFile).not.toBe(originalFile);
    expect(Reflect.get(renamedFile, 'name')).toBe('renamed\uFFFD.txt');
    expect(Reflect.get(renamedFile, 'lastModified')).toBe(123);
    expect(Reflect.get(renamedFile, 'type')).toBe('text/example');
    await expect(call(renamedFile, 'text')).resolves.toBe('file bytes');
  });

  it('creates replacement Files and their results in the FormData realm', async () => {
    const sourceWindow = createWindow();
    const receiverWindow = createWindow();
    const functionWindow = createWindow();
    const formData = construct(receiverWindow, 'FormData');
    const blob = construct(sourceWindow, 'Blob', [['value']]);
    const foreignFormDataPrototype = Reflect.get(
      requireFunction(functionWindow, 'FormData'),
      'prototype',
    ) as object;
    const foreignBlobPrototype = Reflect.get(
      requireFunction(functionWindow, 'Blob'),
      'prototype',
    ) as object;
    const append = Reflect.get(
      foreignFormDataPrototype,
      'append',
    ) as CallableFunction;
    const get = Reflect.get(
      foreignFormDataPrototype,
      'get',
    ) as CallableFunction;

    Reflect.apply(append, formData, ['key', blob]);
    const file = Reflect.apply(get, formData, ['key']) as object;

    expect(file).toBeInstanceOf(requireFunction(receiverWindow, 'File'));
    expect(file).not.toBeInstanceOf(requireFunction(sourceWindow, 'File'));
    expect(file).not.toBeInstanceOf(requireFunction(functionWindow, 'File'));

    const textPromise = Reflect.apply(
      requireFunction(foreignBlobPrototype, 'text'),
      file,
      [],
    ) as Promise<string>;
    const arrayBufferPromise = Reflect.apply(
      requireFunction(foreignBlobPrototype, 'arrayBuffer'),
      file,
      [],
    ) as Promise<ArrayBuffer>;
    const stream = Reflect.apply(
      requireFunction(foreignBlobPrototype, 'stream'),
      file,
      [],
    ) as object;
    const slice = Reflect.apply(
      requireFunction(foreignBlobPrototype, 'slice'),
      file,
      [],
    ) as object;

    expect(textPromise).toBeInstanceOf(requireFunction(receiverWindow, 'Promise'));
    expect(await textPromise).toBe('value');
    expect(await arrayBufferPromise)
      .toBeInstanceOf(requireFunction(receiverWindow, 'ArrayBuffer'));
    expect(stream).toBeInstanceOf(requireFunction(receiverWindow, 'ReadableStream'));
    expect(slice).toBeInstanceOf(requireFunction(receiverWindow, 'Blob'));
  });

  it('uses live Web IDL pair iteration and callback projection', () => {
    const window = createWindow();
    const formData = construct(window, 'FormData');
    call(formData, 'append', ['foo', '0']);
    call(formData, 'append', ['baz', '1']);
    call(formData, 'append', ['BAR', '2']);

    const visited: [string, string][] = [];
    for (const entry of formData as Iterable<[string, string]>) {
      visited.push(entry);
      call(formData, 'delete', ['baz']);
    }
    expect(visited).toEqual([['foo', '0'], ['BAR', '2']]);

    call(formData, 'append', ['last', '3']);
    expect(Array.from(call(formData, 'keys') as Iterable<string>))
      .toEqual(['foo', 'BAR', 'last']);
    expect(Array.from(call(formData, 'values') as Iterable<string>))
      .toEqual(['0', '2', '3']);

    const callback = vi.fn();
    call(formData, 'forEach', [callback]);
    expect(callback.mock.calls).toEqual([
      ['0', 'foo', formData],
      ['2', 'BAR', formData],
      ['3', 'last', formData],
    ]);
  });

  it('exposes the internal entry list to Fetch without platform wrappers', () => {
    const window = createWindow();
    const formData = construct(window, 'FormData');
    const file = construct(window, 'File', [[], 'value.txt']);
    call(formData, 'append', ['file', file]);

    const context = getRealmBindings(getRelevantRealm(window)).context;
    const implementation = context.getImplementation(formData, FormDataImpl);
    if (!implementation) throw new Error('Value is not FormData');
    const entries = FormDataImpl.getEntryList(implementation);

    expect(entries).toHaveLength(1);
    expect(entries[0]![0]).toBe('file');
    expect(entries[0]![1]).toBeInstanceOf(FileImpl);
    expect(entries[0]![1]).not.toBe(file);
  });

  it('keeps the deferred HTML form constructor visibly unavailable', () => {
    const window = createWindow();
    const FormData_ = requireFunction(window, 'FormData');

    expect(() => { Reflect.construct(FormData_, [{}]); })
      .toThrow(/HTMLFormElement/);
  });
});

function createWindow(): Window & typeof globalThis {
  return new Browlet({ route: () => '' }).window as
    Window & typeof globalThis;
}

function construct(
  window: object,
  name: string,
  argumentsList: unknown[] = [],
): object {
  return Reflect.construct(
    requireFunction(window, name),
    argumentsList,
  ) as object;
}

function call(
  object: object,
  name: string,
  argumentsList: unknown[] = [],
): unknown {
  return Reflect.apply(requireFunction(object, name), object, argumentsList);
}

function requireFunction(object: object, name: string): CallableFunction {
  const value = Reflect.get(object, name) as unknown;
  if (typeof value !== 'function') throw new Error(`${name} is not a function`);
  return value;
}
