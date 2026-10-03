
import type { Converter, ConversionSteps } from '../../../../src/web-idl/converters/converter';
import type { BindingContext } from '../../../../src/web-idl/binding/context';
import type { IDLRecord, IDLSequence } from '../../../../src/web-idl/values/value';
import {
  annotated, asyncSequence, idlType, implementationType, promise, record, reference, sequence, xattr,
} from '../../../../src/web-idl/core/index';
import type { IDLAsyncSequence } from '../../../../src/web-idl/values/async-sequence';
import type { IDLPromise } from '../../../../src/web-idl/values/promise';

import type { InternalPromise } from '../../../../src/infra/promises';

declare const converter: Converter;
declare const binding: BindingContext;
declare const authorValue: unknown;

// The supplied descriptor determines the result; the caller cannot choose an unrelated output type.
const number: number = converter.binding.getConverter(converter.binding.assembly.getIDLType(idlType.long), converter.realm).jsToIDL(authorValue);
const clamped: number = converter.binding.getConverter(converter.binding.assembly.getIDLType(annotated(idlType.octet, xattr('Clamp'))), converter.realm).jsToIDL(authorValue);
const string: string = converter.binding.getConverter(converter.binding.assembly.getIDLType(idlType.DOMString), converter.realm).jsToIDL(authorValue);
const buffer: Uint8Array = converter.binding.getConverter(converter.binding.assembly.getIDLType(idlType.Uint8Array), converter.realm).jsToIDL(authorValue);
const convertNumber: ConversionSteps<number> = converter.binding.getConverter(converter.binding.assembly.getIDLType(idlType.double), converter.realm).getJSToIDLSteps();
// @ts-expect-error A numeric conversion cannot promise a string.
const wrongResult: string = converter.binding.getConverter(converter.binding.assembly.getIDLType(idlType.long), converter.realm).jsToIDL(authorValue);
// @ts-expect-error Web IDL any makes no guarantee about the value's shape.
const anyObject: object = converter.binding.getConverter(converter.binding.assembly.getIDLType(idlType.any), converter.realm).jsToIDL(authorValue);

const values: IDLSequence = converter.binding.getConverter(converter.binding.assembly.getIDLType(sequence(idlType.long)), converter.realm).jsToIDL(authorValue);
const entries: IDLRecord = converter.binding.getConverter(converter.binding.assembly.getIDLType(record(idlType.DOMString, idlType.long)), converter.realm).jsToIDL(authorValue);
const promiseValue: IDLPromise = converter.binding.getConverter(converter.binding.assembly.getIDLType(promise(idlType.long)), converter.realm).jsToIDL(authorValue);
const asyncValues: IDLAsyncSequence = converter.binding.getConverter(converter.binding.assembly.getIDLType(asyncSequence(idlType.long)), converter.realm).jsToIDL(authorValue);
// @ts-expect-error A named reference needs this world's assembly; its name alone does not encode the result.
const namedObject: object = converter.binding.getConverter(converter.binding.assembly.getIDLType(reference('Options')), converter.realm).jsToIDL(authorValue);

type Options = { count: number; };
const optionsType = implementationType<Options>(reference('Options'));
// @ts-expect-error The implementation payload does not describe the intermediate IDL dictionary record.
const intermediate: Options = converter.binding.getConverter(converter.binding.assembly.getIDLType(optionsType), converter.realm).jsToIDL(authorValue);
const options: Options = binding.jsToImpl(authorValue, optionsType);
const count: number = binding.jsToImpl(authorValue, idlType.long);
class Example { count = 0; }
const instance: Example = binding.jsToImpl(authorValue, reference(Example));
const unwrappedInstance: Example = converter.binding.getConverter(converter.binding.assembly.getIDLType(reference(Example)), converter.realm).jsToIDL(authorValue);

// The implementation boundary owns fulfillment conversion; the IDL value retains promise state.
const convertedPromise: InternalPromise<number> = binding.jsToImpl(
  authorValue, implementationType<InternalPromise<number>>(promise(idlType.long)),
);
