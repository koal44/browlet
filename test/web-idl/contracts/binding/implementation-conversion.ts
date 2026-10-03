import {
  idlType, nullable, record, reference, sequence, union, type CallbackExceptionBehavior,
} from '../../../../src/web-idl/core/index';
import type { IDLDictionaryType, IDLCallbackFunctionType, IDLCallbackInterfaceType } from '../../../../src/web-idl/assembly/index';
import type { BindingContext } from '../../../../src/web-idl/binding/context';
import type { RealmBinding } from '../../../../src/web-idl/binding/realm';
import type { StampedCallbackFunction } from '../../../../src/web-idl/binding/realm/callback';
import type { IDLDictionary, IDLCallbackFunction, IDLCallbackInterface } from '../../../../src/web-idl/values/index';

declare const binding: RealmBinding;
declare const context: BindingContext;
declare const dictionaryType: IDLDictionaryType;
declare const dictionary: IDLDictionary;
declare const callbackType: IDLCallbackFunctionType;
declare const callback: IDLCallbackFunction;
declare const customCallbackType: IDLCallbackInterfaceType;
declare const customCallback: IDLCallbackInterface;
declare const behavior: CallbackExceptionBehavior;

const conversion = binding.implementationConverter;
const members: Record<string, unknown> = conversion.idlToImpl(dictionary, dictionaryType, {}, context);
const preparedMembers: Record<string, unknown> = conversion.createConverter(dictionaryType, {})(dictionary, context);
// @ts-expect-error Ordinary dictionary conversion consumes a converted IDL value, not author input.
conversion.idlToImpl({}, dictionaryType, {}, context);
// @ts-expect-error A dictionary's implementation representation is its member record.
const stillBoxed: IDLDictionary = conversion.idlToImpl(dictionary, dictionaryType, {}, context);
const bound: StampedCallbackFunction = conversion.idlToImpl(callback, callbackType, { callbackExceptionBehavior: behavior }, context);
const preparedBound: StampedCallbackFunction = conversion.createConverter(callbackType, {})(callback, context);
// @ts-expect-error Callback conversion consumes the captured IDL callback, not an author function.
conversion.createConverter(callbackType, {})(() => {}, context);
const result: unknown = bound();
// @ts-expect-error The callback's runtime declaration does not encode a numeric result statically.
const numericResult: number = bound();

const numbersType = binding.assembly.getIDLType(sequence(idlType.long));
const numbers: number[] = conversion.idlToImpl([1], numbersType, {}, context);
const recordsType = binding.assembly.getIDLType(sequence(record(idlType.DOMString, idlType.long)));
const records: Record<string, number>[] = conversion.createConverter(recordsType, {})([new Map([['count', 1]])], context);
const choiceType = binding.assembly.getIDLType(nullable(union(sequence(idlType.long), idlType.boolean)));
const choice: number[] | boolean | null = conversion.idlToImpl(null, choiceType, {}, context);
class ItemImpl { value = 1; }
const itemType = binding.assembly.getIDLType(reference(ItemImpl));
const item: ItemImpl = conversion.idlToImpl(new ItemImpl(), itemType, {}, context);

// @ts-expect-error Custom callback-interface adapters can return an arbitrary implementation value.
const customObject: object = conversion.idlToImpl(customCallback, customCallbackType, {}, context);
// @ts-expect-error Custom unwrapping may preserve the original object instead of finding an implementation.
const wronglyUnwrapped: ItemImpl = conversion.idlToImpl({}, binding.assembly.getIDLType(idlType.object), { implClasses: [ItemImpl] }, context);
const callbackMembers: Record<string, unknown> = conversion.idlToImpl({}, binding.assembly.getIDLType(idlType.object), {
  callbackDictionary: dictionaryType,
}, context);
