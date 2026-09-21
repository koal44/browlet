import {
  allocateIn, arg, atArg, attr, attrFn, ctor, defineCallbackInterface, defineInterface,
  dictMember, idlType, impl, invokeWith, op, sequence, staticOp,
} from '../../../../src/web-idl/core/index';

declare module '../../../../src/web-idl/core/types' {
  interface DeclarationCallbacks {
    'argument-resolve': (ctx: { global: object; }) => unknown;
  }
}

class Example {}
defineInterface({ name: 'Example', implementation: impl(Example), members: [] });
impl(Example, { constructWith: [atArg(0, (ctx) => ctx.global)] });
ctor([], { constructWith: [atArg(0, () => new Example())] });
op('read', idlType.ArrayBuffer, [], allocateIn('receiver'));
op('names', sequence(idlType.DOMString), [], allocateIn('method'));
op('run', idlType.undefined, [], invokeWith(atArg(0, () => new Example())));
op('existing', idlType.Uint8Array, [], { allocateIn: undefined });
staticOp('create', idlType.object, [], invokeWith(atArg(0, () => new Example())));

// @ts-expect-error A result allocation policy is not a constructor option.
ctor([], allocateIn('receiver'));
// @ts-expect-error Operation dependencies are not constructor dependencies.
ctor([], invokeWith(atArg(0, () => new Example())));
// @ts-expect-error Constructor dependencies are not operation dependencies.
op('run', idlType.undefined, [], { constructWith: [atArg(0, () => new Example())] });
// @ts-expect-error A result allocation policy is not an attribute option.
attr('value', idlType.object, allocateIn('method'));
// @ts-expect-error Result allocation selects the receiver or method realm.
allocateIn('caller');
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
