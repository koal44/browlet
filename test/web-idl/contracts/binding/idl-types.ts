import type { IDLType, IDLSequenceType, AssembledDictionary } from '../../../../src/web-idl/assembly/index';
import type { RealmBinding } from '../../../../src/web-idl/binding/realm';
import { BooleanConverter, BufferSourceConverter, SequenceConverter } from '../../../../src/web-idl/converters/index';
import { idlType, type BufferTypeName, type WebIDLType } from '../../../../src/web-idl/core/index';
import type { JSMethod } from '../../../../src/js-engine/index';
import type { IDLDictionary, IDLCallbackFunction, IDLCallbackInterface } from '../../../../src/web-idl/values/index';

declare const binding: RealmBinding;
declare const declared: WebIDLType;
declare const type: IDLType;
declare const iteratorMethod: JSMethod;

// @ts-expect-error Internal converter lookup accepts only compiled IDL types.
binding.getConverter(declared);
// @ts-expect-error Runtime types cannot be reused as declaration syntax.
const declaration: WebIDLType = type;
// @ts-expect-error Runtime types do not retain a declaration escape hatch.
type.declaredType;

// @ts-expect-error Converter construction requires assembly, not declaration syntax.
new BufferSourceConverter(declared, binding, binding.realm);
// @ts-expect-error A broad assembled type does not prove that this is a buffer conversion.
new BufferSourceConverter(type, binding, binding.realm);
// @ts-expect-error Assembled types contain no unresolved declaration references.
const referenceKind: 'reference' = type.kind;
// @ts-expect-error Conversion rules belong to the applicable type variants.
type.integerMode;

if (type.kind === 'boolean') {
  const converter = new BooleanConverter(type, binding, binding.realm);
  const value: boolean = converter.jsToIDL({});
  const output: boolean = converter.idlToJS(value);
  // @ts-expect-error The kind identifies boolean without a second name discriminator.
  type.name;
  // @ts-expect-error Boolean conversion cannot return an arbitrary object.
  const object: object = converter.jsToIDL({});
}

if (type.kind === 'undefined') {
  const value: undefined = binding.getConverter(type).jsToIDL('discarded');
  const output: undefined = binding.getConverter(type).idlToJS('discarded');
  // @ts-expect-error Boolean converters require their own compiled type.
  new BooleanConverter(type, binding, binding.realm);
}

if (type.kind === 'bigint') {
  const value: bigint = binding.getConverter(type).jsToIDL('10');
}

if (type.kind === 'symbol') {
  const value: symbol = binding.getConverter(type).jsToIDL(Symbol());
}

if (type.kind === 'object') {
  const value: object = binding.getConverter(type).jsToIDL({});
}

const assembledBoolean = binding.assembly.getIDLType(idlType.boolean);
const booleanKind: 'boolean' = assembledBoolean.kind;
const booleanValue: boolean = binding.getConverter(assembledBoolean).jsToIDL(1);

if (type.kind === 'buffer-source') {
  const converter = new BufferSourceConverter(type, binding, binding.realm);
  const name: BufferTypeName = converter.type.name;
  const shared: boolean = converter.type.allowShared;
  // @ts-expect-error Buffer validation has no integer rounding mode.
  converter.type.integerMode;
  // @ts-expect-error A buffer contract cannot construct a sequence converter.
  new SequenceConverter(type, binding, binding.realm);
}

if (type.kind === 'dictionary') {
  const assembled: AssembledDictionary = type.assembled;
  const converter = binding.getConverter(type);
  const sameDictionary: AssembledDictionary = converter.type.assembled;
  const value: IDLDictionary = converter.jsToIDL({});
  const output: object = converter.idlToJS(value);
  // @ts-expect-error An assembled dictionary produces its IDL representation, not a scalar.
  const number: number = converter.jsToIDL({});
}

if (type.kind === 'callback-function') {
  const value: IDLCallbackFunction = binding.getConverter(type).jsToIDL(() => {});
}

if (type.kind === 'callback-interface') {
  const value: IDLCallbackInterface = binding.getConverter(type).jsToIDL({});
}

if (type.kind === 'enumeration') {
  const value: string = binding.getConverter(type).jsToIDL('value');
}

if (type.kind === 'sequence') {
  const converter = binding.getConverter(type);
  converter.jsToIDLIterable({}, iteratorMethod);
  const element: IDLType = converter.type.elementType;
  // @ts-expect-error Nested types have completed assembly too.
  const unfinished: IDLSequenceType = { ...type, elementType: idlType.long };
}

if (type.kind === 'record') {
  const convertKey = binding.getConverter(type.keyType).getJSToIDLSteps();
  const key: string = convertKey('name');
}
