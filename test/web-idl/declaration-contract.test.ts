import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('infers projection callbacks and preserves the host realm through registration', () => {
  const source = `
    import {
      atArg, attrFn, constructWith, ctor, createBindingWorld, defineCapability, defineInterface,
      idlType, impl, op, roAttr, serializeDefinition, type WebIDLRealmHost,
    } from '../../src/web-idl/index';
    import type { RuntimeContext } from '../../src/js-engine/runtime-context';

    declare const runtime: RuntimeContext;
    interface HostRealm extends WebIDLRealmHost {
      eventTimeStamp(): number;
    }
    declare const hostRealm: HostRealm;
    declare const minimalRealm: WebIDLRealmHost;
    class Example {}

    atArg(0, (ctx) => ctx.getRuntime());
    attrFn((ctx) => function value() { return ctx.realm.global; });
    // @ts-expect-error A default binding context has no HTML timing API.
    atArg(0, (ctx) => ctx.realm.eventTimeStamp());

    const definition = defineInterface<HostRealm>({
      name: 'Example',
      implementation: impl(Example, {
        constructWith: [atArg(0, (ctx) => ctx.realm.eventTimeStamp())],
      }),
      members: [
        ctor([], constructWith(atArg(0, (ctx) => ctx.realm.eventTimeStamp()))),
        roAttr('time', idlType.double, {
          get(ctx) { return ctx.realm.eventTimeStamp(); },
        }),
        op('read', idlType.double, [], {
          invoke(ctx) { return ctx.realm.eventTimeStamp(); },
        }),
      ],
    });
    serializeDefinition(definition);
    const capability = defineCapability<RuntimeContext>('runtime');
    const world = createBindingWorld<HostRealm>([definition], {
      capabilities: [capability.for(definition, runtime)],
    });
    const ctx = world.register(hostRealm, {
      createRuntime(ctx) {
        ctx.realm.eventTimeStamp();
        return runtime;
      },
    });
    ctx.realm.eventTimeStamp();
    ctx.getCapability(definition, capability);
    ctx.createPlatformObject(definition);
    ctx.isInterfaceExposed(definition);
    // @ts-expect-error HTML callbacks cannot be installed on the minimal host.
    world.register(minimalRealm);
    // @ts-expect-error A world of arbitrary Web IDL realms cannot run HTML callbacks.
    createBindingWorld<WebIDLRealmHost>([definition]);
  `;
  const { diagnostics } = checkFixture(source);
  expect(diagnostics).toEqual([]);
});

it('checks declaration options without importing the runtime binding', () => {
  const source = `
    import {
      arg, atArg, attr, attrFn, constructWith, ctor, defineCallbackInterface, defineInterface,
      dictMember, idlType, impl, invokeWith, newBufferResult, op, staticOp,
    } from '../../src/web-idl/core/index';

    declare module '../../src/web-idl/core/definition' {
      interface DeclarationCallbacks {
        'argument-resolve': (ctx: { global: object }) => unknown;
      }
    }

    class Example {}
    defineInterface({ name: 'Example', implementation: impl(Example), members: [] });
    impl(Example, { constructWith: [atArg(0, (ctx) => ctx.global)] });
    ctor([], constructWith(atArg(0, () => new Example())));
    ctor([], { constructWith: [atArg(0, () => new Example())] });
    op('read', idlType.ArrayBuffer, [], newBufferResult());
    op('run', idlType.undefined, [], invokeWith(atArg(0, () => new Example())));
    op('existing', idlType.Uint8Array, [], { newBufferResult: false });
    staticOp('create', idlType.object, [], invokeWith(atArg(0, () => new Example())));

    // @ts-expect-error A buffer result policy is not a constructor option.
    ctor([], newBufferResult());
    // @ts-expect-error Operation dependencies are not constructor dependencies.
    ctor([], invokeWith(atArg(0, () => new Example())));
    // @ts-expect-error Constructor dependencies are not operation dependencies.
    op('run', idlType.undefined, [], constructWith(atArg(0, () => new Example())));
    // @ts-expect-error A buffer result policy is not an attribute option.
    attr('value', idlType.object, newBufferResult());
    // @ts-expect-error A declaration cannot carry arbitrary binding metadata.
    ctor([], { binding: { nonsense: true } });
    // @ts-expect-error Injected constructor arguments require explicit positions.
    constructWith(Example);
    // @ts-expect-error Injected operation arguments require explicit positions.
    invokeWith(Example);
    // @ts-expect-error Interface construction also requires explicit positions.
    impl(Example, { constructWith: [Example] });
    // @ts-expect-error Injected arguments require a resolver callback.
    atArg(0, 42);
    // @ts-expect-error A class is not a resolver callback.
    atArg(0, Example);
    // @ts-expect-error Selecting a global also requires a resolver callback.
    atArg(0, 'current-global');
    // @ts-expect-error Resolvers receive the declared context type.
    atArg(0, (ctx) => ctx.missing);
    // @ts-expect-error Raw argument records also require a resolver callback.
    ctor([], { constructWith: [{ index: 0, resolve: 42 }] });
    // @ts-expect-error Static operations select their own static flag.
    staticOp('create', idlType.object, [], { static: false });
    // @ts-expect-error Attribute-function factories require the projection's context signature.
    attr('size', idlType.any, attrFn(() => () => 1));
    // @ts-expect-error Callback dictionary conversion names a dictionary.
    arg('source', idlType.object, { callbackDictionary: 42 });
    // @ts-expect-error Callback exception behavior is report or rethrow.
    dictMember('callback', idlType.object, { callbackExceptionBehavior: 'ignore' });
    // @ts-expect-error Indexed getters must declare how unsupported indices are identified.
    op('item', idlType.object, [], { indexedGetter: { getSupportedPropertyIndices() { return [0]; } } });
    // @ts-expect-error Runtime callbacks require a declared runtime signature.
    ctor([], { construct() { return {}; } });
    // @ts-expect-error Allocation callbacks require the projection's signature.
    impl(Example, { allocatePlatformObject() { return {}; } });
    // @ts-expect-error Initialization callbacks require the projection's signature.
    impl(Example, { initializeImplementation() {} });
    // @ts-expect-error Callback-interface adapters require the projection's signature.
    defineCallbackInterface({ name: 'Callback', members: [], adapter: { adapt() {} } });
  `;
  const { diagnostics, program } = checkFixture(source);
  expect(diagnostics).toEqual([]);

  const sourceDirectory = path.resolve('src') + path.sep;
  const coreDirectory = path.resolve('src/web-idl/core') + path.sep;
  const externalSources = program.getSourceFiles()
    .map((file) => path.resolve(file.fileName))
    .filter((name) => name.startsWith(sourceDirectory) && !name.startsWith(coreDirectory));
  expect(externalSources).toEqual([]);
});

function checkFixture(source: string) {
  const filename = path.resolve('test/web-idl/core-contract-fixture.ts');
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: ['node'],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, ...args) => path.resolve(name) === filename
    ? ts.createSourceFile(name, source, ts.ScriptTarget.ESNext, true)
    : getSourceFile(name, ...args);
  const program = ts.createProgram([filename], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));

  return { diagnostics, program };
}
