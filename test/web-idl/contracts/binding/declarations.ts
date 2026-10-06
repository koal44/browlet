import {
  arg, cbDict, ctor, defineInterface, definePartialInterface, idlType, impl, nullable, op,
  reference, staticOp, tsType, unwrapArg, type WebIDLEnvironment,
} from '../../../../src/web-idl/index';

class Example { value = 1; }

const exampleIDL = defineInterface<WebIDLEnvironment>({
  name: 'Example',
  implementation: impl(Example),
  members: [],
});
const exampleType = reference(Example);

// @ts-expect-error An interface declaration is not an implementation class.
reference(exampleIDL);

definePartialInterface<WebIDLEnvironment>({
  name: 'Example',
  members: [
    op('consume', idlType.undefined,
      [arg('value', tsType(reference(Example), 'Example<T>'))],
      {
        invoke(_ctx, value) {
          value.value.toFixed();
          // @ts-expect-error Platform type refinements preserve converted implementation typing.
          value.missing;
        },
        typeParameters: [{ name: 'T', default: 'any' }],
      },
    ),
    staticOp('read', idlType.double,
      [arg('example', reference(Example)), arg('name', idlType.DOMString)],
      {
        invoke(ctx, example, name) {
          ctx.getEnvironment().realm.global;
          example.value.toFixed();
          name.toUpperCase();
          // @ts-expect-error Interface arguments are implementations, not arbitrary objects.
          example.missing;
          // @ts-expect-error DOMString supplies a string, not a number.
          name.toFixed();
          return example.value;
        },
      },
    ),
    op('optional', idlType.undefined,
      [arg('name', idlType.DOMString, { optional: true })],
      {
        invoke(_ctx, name) {
          name?.toUpperCase();
          // @ts-expect-error An omitted optional argument has no string value.
          name.toUpperCase();
        },
      },
    ),
    op('defaulted', idlType.undefined,
      [arg('name', idlType.DOMString, { optional: true, default: '' })],
      { invoke(_ctx, name) { name.toUpperCase(); } },
    ),
    op('many', idlType.undefined,
      [arg('first', nullable(exampleType)), arg('names', idlType.DOMString, { variadic: true })],
      {
        invoke(_ctx, first, ...names) {
          first?.value.toFixed();
          names.map((name) => name.toUpperCase());
          // @ts-expect-error Each variadic argument has the declared type.
          names.push(1);
        },
      },
    ),
    op('adapted', idlType.undefined,
      [arg('options', idlType.object, cbDict('Options')), arg('value', idlType.object, unwrapArg(Example))],
      {
        invoke(_ctx, options, value) {
          // @ts-expect-error Dictionary adaptation has no declared implementation result type.
          options.value;
          // @ts-expect-error Custom unwrapping may preserve the original object.
          value.value;
        },
      },
    ),
    op('forwardReference', idlType.undefined,
      [arg('example', reference('Example'))],
      {
        invoke(_ctx, example) {
          // @ts-expect-error A string reference alone does not identify an implementation class.
          example.value;
        },
      },
    ),
  ],
});

defineInterface({
  name: 'Constructed',
  members: [
    ctor(
      [arg('name', idlType.DOMString)],
      { construct(_ctx, name) { return { name: name.toUpperCase() }; } },
    ),
  ],
});
