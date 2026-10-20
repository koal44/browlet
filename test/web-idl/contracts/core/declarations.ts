import {
  arg, atArg, attr, attrFn, ctor, defineCallbackInterface, defineInterface, defineProxyObject,
  dictMember, domExceptionIDL, idlType, impl, invokeWith, op, sequence, staticOp, tsType,
  reflect, webIDLCommonDefinitions, xattr,
  type SerialSteps, type TransferSteps, type NamedGetterMember,
} from '../../../../src/web-idl/core/index';

class Example {}
defineInterface({ name: 'Example', implementation: impl(Example), members: [] });
defineInterface({
  name: 'HTMLAllCollection', documentAll: true, implementation: impl(Example),
  members: [op('item', idlType.object, [arg('name', idlType.DOMString, { optional: true })])],
});

const namedGetter = {
  kind: 'named-getter', method: 'getNamedProperty', returns: idlType.DOMString,
} satisfies NamedGetterMember;
defineInterface({ name: 'Named', members: [namedGetter] });
// @ts-expect-error Named getters must identify an implementation method.
const missingGetter: NamedGetterMember = { kind: 'named-getter', returns: idlType.DOMString };
// @ts-expect-error A named getter's key is always one DOMString, not a configurable argument list.
const wrongKey: NamedGetterMember = { ...namedGetter, arguments: [arg('index', idlType.unsignedLong)] };
// @ts-expect-error Named getters do not need imperative binding callbacks.
const imperativeGetter: NamedGetterMember = { ...namedGetter, invoke() {} };

webIDLCommonDefinitions.includes(domExceptionIDL);

attr('span', idlType.unsignedLong, xattr(reflect({ default: 1, range: [1, 1000] })));
// @ts-expect-error A reflection range has exactly two bounds.
reflect({ range: [0] });

const proxy = {};
const handle = { platform: proxy, currentReceiver: {} };
const proxyDefinition = defineProxyObject({
  name: 'ExampleProxy',
  getHandle: (value) => value === proxy ? handle : undefined,
  getProxy: (value) => value === handle ? proxy : undefined,
  resolveReceiver(value) {
    // @ts-expect-error The receiver hook receives the inferred handle, not an arbitrary object.
    value.missing;
    return value.currentReceiver;
  },
});
proxyDefinition.getHandle(proxy)?.currentReceiver;
// @ts-expect-error Receiver resolution requires the handle's retained state.
proxyDefinition.resolveReceiver?.(proxy);

class SavedValue { value = 1; }
op('clone', tsType(idlType.any, 'T'),
  [arg('value', tsType(idlType.any, 'T'))],
  { typeParameters: [{ name: 'T', default: 'any' }] },
);
const serialSteps = {
  serializationSteps(value, record, _forStorage, context) {
    record.fields.Value = value.value;
    record.shouldRestrict = true;
    // @ts-expect-error Each field accepts only its declared value type.
    record.fields.Value = 'wrong';
    // @ts-expect-error Field names come from this interface's record shape.
    record.fields.Missing = 1;
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
    value.value = record.fields.Value;
    // @ts-expect-error Reading a field retains its declared value type.
    record.fields.Value.toUpperCase();
    // @ts-expect-error The matching serializer defines the available fields.
    record.fields.Missing;
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

impl(Example, { constructWith: [atArg(0, (env: { global: object; }) => env.global)] });
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
atArg(0, (env) => env.missing);
// @ts-expect-error Raw argument records also require a resolver callback.
ctor([], { constructWith: [{ index: 0, resolve: 42 }] });
// @ts-expect-error Static operations select their own static flag.
staticOp('create', idlType.object, [], { static: false });
attr('size', idlType.any, attrFn(() => () => 1));
// @ts-expect-error Callback dictionary conversion names a dictionary.
arg('source', idlType.object, { callbackDictionary: 42 });
// @ts-expect-error Callback exception behavior is report or rethrow.
dictMember('callback', idlType.object, { callbackExceptionBehavior: 'ignore' });
// @ts-expect-error Indexed getters must declare how unsupported indices are identified.
op('item', idlType.object, [], { indexedGetter: { getSupportedPropertyIndices() { return [0]; } } });
ctor([], { construct() { return {}; } });
// @ts-expect-error Backing allocation belongs to Binding, not declaration hooks.
impl(Example, { allocatePlatformObject() { return {}; } });
// @ts-expect-error document.all uses declarative interface metadata, not an allocation callback.
impl(Example, { createHTMLAllCollection() { return {}; } });
impl(Example, { initializeImplementation() {} });
defineCallbackInterface({ name: 'Callback', members: [], toImpl() {} });

type ExampleEnvironment = { realm: { name: string; }; token: object; };
defineInterface<ExampleEnvironment>({
  name: 'Portable', implementation: impl(Example, {
    initializeImplementation(env, value) {
      env.realm.name.toUpperCase();
      value satisfies Example;
      // @ts-expect-error Implementation initialization has no Binding Context.
      env.project(Example, value);
    },
  }),
  members: [
    ctor(
      [arg('name', idlType.DOMString)],
      {
        construct(env, name) {
          name.toUpperCase();
          return { name, token: env.token };
        },
      },
    ),
    attr('name', idlType.DOMString, {
      get(env) { return env.realm.name; },
      set(env, value) {
        env.realm.name = value as string;
        // @ts-expect-error Ordinary declaration steps cannot perform Web IDL conversion.
        env.jsToImpl(value, idlType.DOMString);
      },
    }),
    op('select', idlType.object,
      [],
      invokeWith(atArg(0, (env, methodEnv) => {
        env.realm.name.toUpperCase();
        return methodEnv.token;
      })),
    ),
  ],
});
defineCallbackInterface<ExampleEnvironment>({
  name: 'PortableCallback', members: [op('run', idlType.undefined)],
  toImpl(env, callback) {
    env.token satisfies object;
    callback.realm.name.toUpperCase();
    callback.object satisfies object;
    callback.callUserObjectOperation('run', []);
    // @ts-expect-error Callback adapters cannot reach the binding assembly.
    callback.assembled;
    return callback.object;
  },
});
