import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { DefinitionAssembly } from '../../src/web-idl/assembly/index';
import { generatePlatformTypes } from '../../src/web-idl/generate';
import {
  annotated, arg, asyncIter, attr, constant, ctor, defineCallbackFunction, defineCallbackInterface,
  defineDictionary, defineEnumeration, defineIncludes, defineInterface, defineInterfaceMixin,
  defineNamespace, definePartialDictionary, definePartialInterface, definePartialInterfaceMixin,
  definePartialNamespace, defineProxyObject, defineTypedef, dictMember, frozenArray, idlType,
  impl, iter, maplike, nullable, op, promise, record, reference, roAttr, sequence, setlike,
  staticOp, stringifier, union, xattr,
} from '../../src/web-idl/core/index';

describe('platform declaration generation', () => {
  it('compiles an author API with assembled inheritance, mixins, overloads, constructors, and input/output types', () => {
    class EntryImpl {}
    const assembly = new DefinitionAssembly([
      defineInterface({
        name: 'Entry', exposed: 'Window', implementation: impl(EntryImpl),
        members: [roAttr('id', idlType.long)],
      }),
      defineInterfaceMixin({ name: 'Labels', members: [attr('label', idlType.DOMString)] }),
      definePartialInterfaceMixin({ name: 'Labels', members: [op('reset', idlType.undefined)] }),
      defineEnumeration({ name: 'Mode', values: ['fast', 'careful'] }),
      defineTypedef({ name: 'EntryList', type: sequence(reference(EntryImpl)) }),
      defineDictionary({ name: 'BaseOptions', members: [dictMember('mode', reference('Mode'), { required: true })] }),
      defineDictionary({
        name: 'Options', inherits: 'BaseOptions',
        members: [
          dictMember('items', reference('EntryList')),
          dictMember('count', idlType.long, { default: { kind: 'integer', value: '2' } }),
          dictMember('next', nullable(reference('Options'))),
        ],
      }),
      definePartialDictionary({ name: 'Options', members: [dictMember('enabled', idlType.boolean)] }),
      defineCallbackFunction({
        name: 'Complete', arguments: [arg('items', sequence(reference('Entry')))], returns: promise(idlType.long),
      }),
      defineCallbackInterface({
        name: 'Listener', members: [op('handle', idlType.undefined, [arg('entry', reference('Entry'))])],
      }),
      defineInterface({
        name: 'Store', inherits: 'Entry', exposed: 'Window',
        members: [
          ctor([arg('options', reference('Options'))]),
          op('read', reference(EntryImpl), [arg('key', idlType.DOMString)]),
          op('read', reference(EntryImpl), [arg('key', idlType.long)]),
          op('write', idlType.undefined, [arg('items', reference('EntryList'))]),
          op('complete', idlType.undefined, [arg('callback', reference('Complete'))]),
          op('listen', idlType.undefined, [arg('callback', reference('Listener'))]),
          op('wait', promise(reference('Entry')), [arg('pending', promise(reference('Entry')))]),
          op('append', idlType.undefined, [arg('entries', reference('Entry'), { variadic: true })]),
          roAttr('options', reference('Options')),
          attr('entries', sequence(reference('Entry'))),
          roAttr('frozen', frozenArray(reference('Entry'))),
          roAttr('byName', record(idlType.DOMString, reference('Entry'))),
          staticOp('create', reference('Store')),
          stringifier(),
        ],
      }),
      definePartialInterface({ name: 'Store', members: [roAttr('mode', reference('Mode'))] }),
      defineIncludes({ interface: 'Store', mixin: 'Labels' }),
      defineProxyObject({ name: 'StoreProxy', is: () => false }),
    ]);
    const declarations = generatePlatformTypes(assembly, { proxyInterfaces: { StoreProxy: 'Store' } });
    expect(compile(declarations, `
      import type { Store, StoreConstructor, StoreProxy, Entry, EntryList, Options } from './platform';
      declare const Store: StoreConstructor;
      declare const entry: Entry;
      const store = new Store({ mode: 'fast' });
      const inherited: number = store.id;
      store.label = 'new';
      store.reset();
      const proxy: StoreProxy = store;
      const entryList: EntryList = new Set([entry]);
      store.write(entryList);
      store.entries = entryList;
      const entries: Entry[] = store.entries;
      const count: number | undefined = store.options.count;
      const optional: boolean | undefined = store.options.enabled;
      const nested: number | undefined = store.options.next?.count;
      const input: Options = { mode: 'careful', items: new Set([entry]) };
      store.complete(items => items.length);
      store.complete(items => Promise.resolve(items.length));
      store.listen(value => { const id: number = value.id; });
      store.listen({ handle(value) { const id: number = value.id; } });
      const result: Promise<Entry> = store.wait(entry);
      store.wait(Promise.resolve(entry));
      store.read('name');
      store.read(1);
      store.append(entry, entry);
      const fresh: Store = Store.create();
      const text: string = store.toString();
      const found: Entry = store.byName.example;
      // @ts-expect-error input defaults do not guarantee output properties are populated
      const guaranteed: number = store.options.count;
      // @ts-expect-error interface object prototypes cannot be replaced
      Store.prototype = store;
      // @ts-expect-error no unrelated implementation members
      store.internalState;
      // @ts-expect-error read-only platform attribute
      store.id = 3;
      // @ts-expect-error enum membership
      new Store({ mode: 'bad' });
      // @ts-expect-error required dictionary member
      new Store({});
      // @ts-expect-error overloaded argument has neither declared type
      store.read(true);
      // @ts-expect-error frozen output array
      store.frozen.push(entry);
      // @ts-expect-error native Promise exposes platform entries
      const wrong: Promise<number> = store.wait(entry);
    `)).toEqual([]);
    expect(generatePlatformTypes(assembly, { proxyInterfaces: { StoreProxy: 'Store' } })).toBe(declarations);
  });

  it('emits collection and iterator surfaces while respecting explicit methods', () => {
    const assembly = new DefinitionAssembly([
      defineInterface({ name: 'MapView', members: [maplike(idlType.DOMString, idlType.long)] }),
      defineInterface({ name: 'SetView', members: [setlike(idlType.DOMString, { readonly: true })] }),
      defineInterface({ name: 'Pairs', members: [iter(idlType.long, { key: idlType.DOMString })] }),
      defineInterface({
        name: 'AsyncValues',
        members: [asyncIter(idlType.long, { arguments: [arg('start', idlType.long, { optional: true })] })],
      }),
      defineInterface({
        name: 'CustomMap',
        members: [maplike(idlType.DOMString, idlType.long), op('get', idlType.DOMString, [arg('key', idlType.DOMString)])],
      }),
      defineInterface({
        name: 'Indexed', members: [op('item', idlType.DOMString, [arg('index', idlType.unsignedLong)], { special: 'getter' })],
      }),
      defineInterface({
        name: 'WritableIndexed', inherits: 'Indexed', members: [
          op('set', idlType.undefined, [arg('index', idlType.unsignedLong), arg('value', idlType.DOMString)], { special: 'setter' }),
        ],
      }),
    ]);
    expect(compile(generatePlatformTypes(assembly), `
      import type { MapView, SetView, Pairs, AsyncValues, CustomMap, Indexed, IndexedConstructor, WritableIndexed } from './platform';
      declare const map: MapView;
      declare const set: SetView;
      declare const pairs: Pairs;
      declare const asyncValues: AsyncValues;
      declare const custom: CustomMap;
      declare const indexed: Indexed;
      declare const writable: WritableIndexed;
      declare const Indexed: IndexedConstructor;
      const entry: [string, number] | undefined = [...map][0];
      const pair: [string, number] | undefined = [...pairs][0];
      const mutable: MapView = map.set('one', 1);
      const value: number | undefined = map.get('one');
      map.forEach((value, key, parent) => { const owner: MapView = parent; });
      const text: string = custom.get('one');
      const pending: AsyncIterableIterator<number> = asyncValues.values(5);
      const element: string | undefined = indexed[0];
      const values: string[] = [...indexed];
      writable[0] = 'value';
      declare const candidate: unknown;
      if (candidate instanceof Indexed) { const value: Indexed = candidate; }
      // @ts-expect-error read-only collection
      set.add('one');
      // @ts-expect-error value-only async iteration has no keys method
      asyncValues.keys();
      // @ts-expect-error no indexed setter
      indexed[0] = 'one';
      // @ts-expect-error indexed properties alone do not install named iteration methods
      indexed.values();
    `)).toEqual([]);
  });

  it('uses exposure, partials, aliases, and namespaces to describe installed globals', () => {
    const assembly = new DefinitionAssembly([
      defineInterface({ name: 'Host', exposed: 'Window', ...xattr(['Global', 'Window']), members: [] }),
      defineInterface({
        name: 'Thing', exposed: 'Window', ...xattr(['LegacyWindowAlias', 'OldThing']),
        members: [ctor(), roAttr('secure', idlType.boolean, xattr('SecureContext'))],
      }),
      definePartialInterface({ name: 'Thing', exposed: 'Worker', members: [roAttr('workerOnly', idlType.boolean)] }),
      defineInterface({ name: 'WorkerThing', exposed: 'Worker', members: [ctor()] }),
      defineInterface({ name: 'Hidden', exposed: 'Window', ...xattr('LegacyNoInterfaceObject'), members: [] }),
      defineNamespace({ name: 'Tools', exposed: 'Window', members: [op('run', idlType.undefined)] }),
      definePartialNamespace({ name: 'Tools', members: [roAttr('version', idlType.DOMString)] }),
      defineInterface({ name: 'Namespaced', exposed: 'Window', ...xattr(['LegacyNamespace', 'Tools']), members: [ctor()] }),
      defineInterface({
        name: 'FactoryProduct', exposed: 'Window', extendedAttributes: [{
          kind: 'named-arguments', name: 'LegacyFactoryFunction', value: 'Factory', arguments: [arg('n', idlType.long)],
        }], members: [],
      }),
    ]);
    const declarations = generatePlatformTypes(assembly, {
      exposure: { globalNames: new Set(['Window']), secureContext: false, crossOriginIsolated: false },
    });
    expect(compile(declarations, `
      import type { Host, Thing, FactoryProduct } from './platform';
      declare const host: Host;
      const thing: Thing = new host.Thing();
      new host.OldThing();
      new host.Tools.Namespaced();
      const product: FactoryProduct = new host.Factory(1);
      host.Tools.run();
      const version: string = host.Tools.version;
      // @ts-expect-error secure attribute excluded by the selected profile
      thing.secure;
      // @ts-expect-error partial is exposed in workers
      thing.workerOnly;
      // @ts-expect-error worker constructor is not installed here
      host.WorkerThing;
      // @ts-expect-error namespace constructor is not a global property
      host.Namespaced;
      // @ts-expect-error LegacyNoInterfaceObject
      host.Hidden;
    `)).toEqual([]);
  });

  it('models forwarded setters and requires an explicit proxy surface', () => {
    const assembly = new DefinitionAssembly([
      defineInterface({ name: 'Location', members: [attr('href', idlType.USVString)] }),
      defineInterface({
        name: 'Window', members: [
          roAttr('location', reference('Location'), xattr(['PutForwards', 'href'])),
          roAttr('self', reference('WindowProxy'), xattr('Replaceable')),
          roAttr('style', idlType.object, xattr(['PutForwards', 'cssText'])),
        ],
      }),
      defineProxyObject({ name: 'WindowProxy', is: () => false }),
    ]);
    expect(() => generatePlatformTypes(assembly)).toThrow('proxyInterfaces');
    const declarations = generatePlatformTypes(assembly, { proxyInterfaces: { WindowProxy: 'Window' } });
    expect(declarations).toContain('forwarded property opaque');
    expect(compile(declarations, `
      import type { WindowProxy, Location } from './platform';
      declare const window: WindowProxy;
      const location: Location = window.location;
      window.location = 'https://example.test/';
      window.self = 5;
      const style: object = window.style;
      // @ts-expect-error forwarding uses href's input type
      window.location = 42;
      // @ts-expect-error the declaration does not describe CSSOM's shape yet
      window.style.cssText;
    `)).toEqual([]);
  });

  it('keeps buffer sharing, escaped names, and generated-name collisions typed', () => {
    const assembly = new DefinitionAssembly([
      defineDictionary({ name: 'Data', members: [dictMember('data-value', union(idlType.long, idlType.DOMString))] }),
      defineInterface({ name: 'DataResult', members: [] }),
      defineInterface({
        name: 'View', members: [
          constant('ACTIVE', idlType.boolean, true),
          constant('LIMIT', idlType.unsignedLong, { kind: 'integer', value: '0x10' }),
          roAttr('data', reference('Data')),
          op('read', idlType.Uint8Array, [arg('default', idlType.Uint8Array)]),
          op('share', idlType.undefined, [arg('value', annotated(idlType.Uint8Array, xattr('AllowShared')))]),
        ],
      }),
    ]);
    expect(compile(generatePlatformTypes(assembly), `
      import type { View, ViewConstructor } from './platform';
      declare const view: View;
      declare const View: ViewConstructor;
      const value: string | number | undefined = view.data['data-value'];
      const active: true = View.ACTIVE;
      const limit: 16 = View.LIMIT;
      const result: Uint8Array<ArrayBuffer> = view.read(new Uint8Array(new ArrayBuffer(1)));
      view.share(new Uint8Array(new SharedArrayBuffer(1)));
      // @ts-expect-error shared backing is disallowed
      view.read(new Uint8Array(new SharedArrayBuffer(1)));
    `)).toEqual([]);
  });
});

/** Compile the emitted module and an independent consumer without lib.dom or Node globals. */
function compile(declarations: string, consumer: string): string[] {
  const sources = new Map([
    [resolve('platform.d.ts'), declarations],
    [resolve('consumer.ts'), consumer],
  ]);
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, skipLibCheck: false,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.esnext.d.ts'], types: [],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (file) => sources.has(resolve(file)) || fileExists(file);
  host.getSourceFile = (file, version, onError, shouldCreateNewSourceFile) => {
    const source = sources.get(resolve(file));
    return source === undefined ? getSourceFile(file, version, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(file, source, version, true);
  };
  const program = ts.createProgram([...sources.keys()], options, host);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const position = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    return `${diagnostic.file?.fileName}:${position ? position.line + 1 : ''} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
  });
}
