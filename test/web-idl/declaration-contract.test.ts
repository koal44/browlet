import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('infers projection callbacks and preserves the host realm through registration', () => {
  const source = `
    import {
      atArg, attrFn, ctor, BindingWorld, defineCapability, defineInterface,
      idlType, impl, isStampedImplInstance, isStampedPlatformObject, op, roAttr, serializeDefinition,
      type StampedImplInstance, type StampedPlatformObject, type WebIDLRealmHost,
    } from '../../src/web-idl/index';
    import type { RuntimeContext } from '../../src/js-engine/runtime-context';

    declare const runtime: RuntimeContext;
    interface HostRealm extends WebIDLRealmHost {
      eventTimeStamp(): number;
    }
    declare const hostRealm: HostRealm;
    declare const minimalRealm: WebIDLRealmHost;
    class Example { value = 1; }

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
        ctor([], {
          constructWith: [atArg(0, (ctx) => ctx.realm.eventTimeStamp())],
        }),
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
    const world = new BindingWorld<HostRealm>([definition], {
      capabilities: [capability.for(definition, runtime)],
    });
    const ctx = world.register(hostRealm, {
      createRuntime(ctx) {
        ctx.realm.eventTimeStamp();
        return runtime;
      },
    });
    ctx.realm.eventTimeStamp();
    world.forRealm(hostRealm)?.realm.eventTimeStamp();
    ctx.getCapability(definition, capability);
    ctx.createPlatformRecord(definition);
    ctx.isInterfaceExposed(definition);
    const implInst: StampedImplInstance<Example> = ctx.construct(Example);
    implInst.value.toFixed();
    const platformObject: StampedPlatformObject = ctx.project(Example, implInst);
    const projected: StampedPlatformObject | undefined = world.project(implInst);
    const created: StampedPlatformObject | undefined = ctx.createPlatformRecord(definition).platformObject;
    const unwrapped: StampedImplInstance<Example> | undefined = ctx.unwrap(platformObject, Example);
    unwrapped?.value.toFixed();
    const plain = new Example();
    // @ts-expect-error An ordinary instance has no stamped platform record.
    const unstamped: StampedImplInstance<Example> = plain;
    // @ts-expect-error An implementation stamp is not a platform stamp.
    const notPlatform: StampedPlatformObject = implInst;
    // @ts-expect-error A platform stamp does not expose its implementation's stamp.
    const notImpl: StampedImplInstance = platformObject;
    if (isStampedImplInstance(plain)) {
      const recognized: StampedImplInstance<Example> = plain;
      recognized.value.toFixed();
    }
    if (isStampedPlatformObject(plain)) {
      const recognized: StampedPlatformObject<Example> = plain;
      recognized.value.toFixed();
    }
    // @ts-expect-error HTML callbacks cannot be installed on the minimal host.
    world.register(minimalRealm);
    // @ts-expect-error This world's realm lookup requires the same host type as registration.
    world.forRealm(minimalRealm);
    // @ts-expect-error A world of arbitrary Web IDL realms cannot run HTML callbacks.
    new BindingWorld<WebIDLRealmHost>([definition]);
  `;
  const { diagnostics } = checkFixture(source);
  expect(diagnostics).toEqual([]);
});

it('checks declaration options without importing the runtime binding', () => {
  const source = `
    import {
      arg, atArg, attr, attrFn, ctor, defineCallbackInterface, defineInterface,
      dictMember, idlType, impl, invokeWith, newBufferResult, op, staticOp,
    } from '../../src/web-idl/core/index';

    declare module '../../src/web-idl/core/types' {
      interface DeclarationCallbacks {
        'argument-resolve': (ctx: { global: object }) => unknown;
      }
    }

    class Example {}
    defineInterface({ name: 'Example', implementation: impl(Example), members: [] });
    impl(Example, { constructWith: [atArg(0, (ctx) => ctx.global)] });
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
    op('run', idlType.undefined, [], { constructWith: [atArg(0, () => new Example())] });
    // @ts-expect-error A buffer result policy is not an attribute option.
    attr('value', idlType.object, newBufferResult());
    // @ts-expect-error A declaration cannot carry arbitrary binding metadata.
    ctor([], { binding: { nonsense: true } });
    // @ts-expect-error Injected constructor arguments require explicit positions.
    ctor([], { constructWith: [Example] });
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
    defineCallbackInterface({ name: 'Callback', members: [], adapt() {} });
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

it('preserves implementation identity and validated buffer and type results', () => {
  const source = `
    import type { AssembledInterfaceDefinition, DefinitionAssembly } from '../../src/web-idl/assembly';
    import { convertBufferSourceToIDL, convertBufferSourceToJavaScript } from '../../src/web-idl/buffer-source';
    import type { StampedImplInstance, PlatformRecord, WebIDLType } from '../../src/web-idl/index';
    import {
      associatePlatformObject, getImplementationRecord, getPlatformRecord,
      stampImplementation,
    } from '../../src/web-idl/platform-object';
    import type { RealmBinding } from '../../src/web-idl/realm-binding';
    import { getUnannotatedType } from '../../src/web-idl/types';

    declare const binding: RealmBinding;
    const primaryInterface: AssembledInterfaceDefinition = binding.resolveInterface('Example');
    declare const definitions: DefinitionAssembly;
    declare const type: WebIDLType;
    declare const authorValue: unknown;
    const implInst = { count: 1 };
    const platformObject = { authorProperty: true };

    const projected: PlatformRecord<typeof implInst> = binding.projectPlatformObject(implInst, primaryInterface);
    const created: PlatformRecord = binding.createPlatformRecord(primaryInterface);
    const global: PlatformRecord<typeof implInst> = binding.projectGlobalObject(implInst, primaryInterface);
    const paired: PlatformRecord<typeof implInst> = binding.initializePlatformObject(platformObject, primaryInterface, implInst);
    // @ts-expect-error The implementation must be supplied separately from the platform object.
    binding.initializePlatformObject(platformObject, primaryInterface);
    const registered: PlatformRecord<typeof implInst> = associatePlatformObject(platformObject, implInst, primaryInterface, binding);
    const found: StampedImplInstance<typeof implInst> | undefined = getImplementationRecord(implInst)?.implInst;
    const stamped = stampImplementation(implInst, primaryInterface, binding);
    const foundStamped: StampedImplInstance<typeof implInst> | undefined = getImplementationRecord(stamped)?.implInst;
    // @ts-expect-error Name lookup accepts a name, not an already assembled definition.
    binding.resolveInterface(primaryInterface);
    // @ts-expect-error Internal creation requires the already assembled primary interface.
    binding.createPlatformRecord('Example');
    // @ts-expect-error Internal projection requires the already assembled primary interface.
    binding.projectGlobalObject(implInst, 'Example');
    binding.context.projectGlobalObject(implInst, 'Example');
    // @ts-expect-error The external projection boundary accepts an interface name.
    binding.context.projectGlobalObject(implInst, primaryInterface);
    projected.implInst.count.toFixed();
    // @ts-expect-error The record retains the implementation shape, not the platform shape.
    paired.implInst.authorProperty;
    // @ts-expect-error An unknown incoming value does not identify a concrete implementation type.
    getImplementationRecord(authorValue)?.implInst.count;
    // @ts-expect-error A platform-object lookup cannot infer the shape of its implementation from its key.
    getPlatformRecord(platformObject)?.implInst.authorProperty;

    const buffer: ArrayBufferLike | ArrayBufferView = convertBufferSourceToIDL(authorValue, 'Uint8Array', []);
    const returnedBuffer: ArrayBufferLike | ArrayBufferView = convertBufferSourceToJavaScript(authorValue, 'ArrayBuffer');
    buffer.byteLength.toFixed();
    returnedBuffer.byteLength.toFixed();
    // @ts-expect-error Outer annotations have been removed from the result.
    const annotation: 'annotated' = getUnannotatedType(type, definitions).kind;
  `;
  const { diagnostics } = checkFixture(source);
  expect(diagnostics).toEqual([]);
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
