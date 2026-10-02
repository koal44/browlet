import type { ConversionContext } from '../../../../src/web-idl/conversion-context';
import type { BindingContext } from '../../../../src/web-idl/binding-context';
import {
  jsToIDL,
  type IDLRecordValue, type IDLSequenceValue, type ValueConverter,
} from '../../../../src/web-idl/conversion';
import {
  annotated, asyncSequence, idlType, implementationType, promise, record, reference, sequence, xattr,
} from '../../../../src/web-idl/core/index';
import type { AsyncSequenceCarrier } from '../../../../src/web-idl/async-sequence';
import type { PromiseCarrier } from '../../../../src/web-idl/promise';

import type { InternalPromise } from '../../../../src/infra/promises';

declare const ctx: ConversionContext;
declare const binding: BindingContext;
declare const authorValue: unknown;

// The supplied descriptor determines the result; the caller cannot choose an unrelated output type.
const number: number = jsToIDL(authorValue, ctx.binding.getConversionContext(idlType.long, ctx.realm));
const clamped: number = jsToIDL(authorValue, ctx.binding.getConversionContext(annotated(idlType.octet, xattr('Clamp')), ctx.realm));
const string: string = jsToIDL(authorValue, ctx.binding.getConversionContext(idlType.DOMString, ctx.realm));
const buffer: Uint8Array = jsToIDL(authorValue, ctx.binding.getConversionContext(idlType.Uint8Array, ctx.realm));
const convertNumber: ValueConverter<number> = ctx.binding.getConversionContext(idlType.double, ctx.realm).getJSToIDLConverter();
// @ts-expect-error A numeric conversion cannot promise a string.
const wrongResult: string = jsToIDL(authorValue, ctx.binding.getConversionContext(idlType.long, ctx.realm));
// @ts-expect-error Web IDL any makes no guarantee about the value's shape.
const anyObject: object = jsToIDL(authorValue, ctx.binding.getConversionContext(idlType.any, ctx.realm));

const values: IDLSequenceValue = jsToIDL(authorValue, ctx.binding.getConversionContext(sequence(idlType.long), ctx.realm));
const entries: IDLRecordValue = jsToIDL(authorValue, ctx.binding.getConversionContext(record(idlType.DOMString, idlType.long), ctx.realm));
const promiseValue: PromiseCarrier = jsToIDL(authorValue, ctx.binding.getConversionContext(promise(idlType.long), ctx.realm));
const asyncValues: AsyncSequenceCarrier = jsToIDL(authorValue, ctx.binding.getConversionContext(asyncSequence(idlType.long), ctx.realm));
// @ts-expect-error A named reference needs this world's assembly; its name alone does not encode the result.
const namedObject: object = jsToIDL(authorValue, ctx.binding.getConversionContext(reference('Options'), ctx.realm));

type Options = { count: number; };
const optionsType = implementationType<Options>(reference('Options'));
// @ts-expect-error The implementation payload does not describe the intermediate IDL dictionary record.
const intermediate: Options = jsToIDL(authorValue, ctx.binding.getConversionContext(optionsType, ctx.realm));
const options: Options = binding.jsToImpl(authorValue, optionsType);
const count: number = binding.jsToImpl(authorValue, idlType.long);
class Example { count = 0; }
const instance: Example = binding.jsToImpl(authorValue, reference(Example));
const unwrappedInstance: Example = jsToIDL(authorValue, ctx.binding.getConversionContext(reference(Example), ctx.realm));

// A promise bridge retains the result selected by the fulfillment converter.
const convertedPromise: InternalPromise<number> = promiseValue.toImpl(ctx.binding, () => 3, binding.Promise);
