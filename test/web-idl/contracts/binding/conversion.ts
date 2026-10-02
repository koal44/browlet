import type { BindingContext } from '../../../../src/web-idl/binding-context';
import {
  jsToIDL, createJSToIDLConverter,
  type ConversionContext, type IDLRecordValue, type IDLSequenceValue, type ValueConverter,
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
const number: number = jsToIDL(authorValue, idlType.long, ctx);
const clamped: number = jsToIDL(authorValue, annotated(idlType.octet, xattr('Clamp')), ctx);
const string: string = jsToIDL(authorValue, idlType.DOMString, ctx);
const buffer: Uint8Array = jsToIDL(authorValue, idlType.Uint8Array, ctx);
const convertNumber: ValueConverter<number> = createJSToIDLConverter(idlType.double, ctx.binding.assembly);
// @ts-expect-error A numeric conversion cannot promise a string.
const wrongResult: string = jsToIDL(authorValue, idlType.long, ctx);
// @ts-expect-error Web IDL any makes no guarantee about the value's shape.
const anyObject: object = jsToIDL(authorValue, idlType.any, ctx);

const values: IDLSequenceValue = jsToIDL(authorValue, sequence(idlType.long), ctx);
const entries: IDLRecordValue = jsToIDL(authorValue, record(idlType.DOMString, idlType.long), ctx);
const promiseValue: PromiseCarrier = jsToIDL(authorValue, promise(idlType.long), ctx);
const asyncValues: AsyncSequenceCarrier = jsToIDL(authorValue, asyncSequence(idlType.long), ctx);
// @ts-expect-error A named reference needs this world's assembly; its name alone does not encode the result.
const namedObject: object = jsToIDL(authorValue, reference('Options'), ctx);

type Options = { count: number; };
const optionsType = implementationType<Options>(reference('Options'));
// @ts-expect-error The implementation payload does not describe the intermediate IDL dictionary record.
const intermediate: Options = jsToIDL(authorValue, optionsType, ctx);
const options: Options = binding.jsToImpl(authorValue, optionsType);
const count: number = binding.jsToImpl(authorValue, idlType.long);
class Example { count = 0; }
const instance: Example = binding.jsToImpl(authorValue, reference(Example));
const unwrappedInstance: Example = jsToIDL(authorValue, reference(Example), ctx);

// A promise bridge retains the result selected by the fulfillment converter.
const convertedPromise: InternalPromise<number> = promiseValue.toImpl(ctx, () => 3, binding.Promise);
