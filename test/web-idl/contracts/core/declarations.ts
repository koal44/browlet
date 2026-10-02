import {
  arg, atArg, attr, attrFn, ctor, defineCallbackInterface, defineInterface,
  dictMember, idlType, impl, invokeWith, op, sequence, staticOp, xattr,
  type SerialSteps, type TransferSteps,
} from '../../../../src/web-idl/core/index';

declare module '../../../../src/web-idl/core/types' {
  interface DeclarationCallbacks {
    'argument-resolve': (ctx: { global: object; }) => unknown;
  }
}

class Example {}
defineInterface({ name: 'Example', implementation: impl(Example), members: [] });

class SavedValue { value = 1; }
const serialSteps = {
  serializationSteps(value, record, _forStorage, context) {
    record.set('Value', value.value);
    // @ts-expect-error Each field accepts only its declared value type.
    record.set('Value', 'wrong');
    // @ts-expect-error Field names come from this interface's record shape.
    record.set('Missing', 1);
    const nested = context.subserialize(value);
    context.subserialize(value, SavedValue);
    // @ts-expect-error The declared implementation must accept the nested value.
    context.subserialize({ value: 'wrong' }, SavedValue);
    // @ts-expect-error Nested records are opaque; their representation belongs to HTML.
    nested.type;
    // @ts-expect-error Steps retain their concrete implementation type.
    value.missing;
  },
  deserializationSteps(record, value, targetRealm, context) {
    value.value = targetRealm.example;
    value.value = record.get('Value');
    // @ts-expect-error Reading a field retains its declared value type.
    record.get('Value').toUpperCase();
    // @ts-expect-error The matching serializer defines the available fields.
    record.get('Missing');
    context.unwrap(context.subdeserialize({}), SavedValue).value.toFixed();
    // @ts-expect-error An operation context does not expose Binding Context.
    context.getEnvironment();
  },
} satisfies SerialSteps<SavedValue, { Value: number; }, { example: number; }>;
defineInterface<{ realm: { example: number; }; }>({
  name: 'SavedValue', ...xattr('Serializable'),
  implementation: impl(SavedValue), serialSteps, members: [],
});
defineInterface<{ realm: { example: number; }; }>({
  name: 'InlineSavedValue', ...xattr('Serializable'), members: [],
  serialSteps: {
    serializationSteps() {},
    deserializationSteps(_record, _value, targetRealm) {
      targetRealm.example.toFixed();
      // @ts-expect-error The declaration's environment determines the destination realm.
      targetRealm.missing;
    },
  },
});
// @ts-expect-error Serializable interfaces need both directions.
const incompleteSerialization: SerialSteps = { serializationSteps() {} };
// @ts-expect-error Transferable interfaces need both directions.
const incompleteTransfer: TransferSteps = { transferSteps() {} };

impl(Example, { constructWith: [atArg(0, (ctx) => ctx.global)] });
ctor([], { constructWith: [atArg(0, () => new Example())] });
op('run', idlType.undefined, [], invokeWith(atArg(0, () => new Example())));
staticOp('create', idlType.object, [], invokeWith(atArg(0, () => new Example())));

// @ts-expect-error Operation dependencies are not constructor dependencies.
ctor([], invokeWith(atArg(0, () => new Example())));
// @ts-expect-error Constructor dependencies are not operation dependencies.
op('run', idlType.undefined, [], { constructWith: [atArg(0, () => new Example())] });
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
defineCallbackInterface({ name: 'Callback', members: [], toImpl() {} });
