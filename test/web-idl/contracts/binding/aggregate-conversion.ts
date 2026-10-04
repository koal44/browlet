import type { JSMethod } from '../../../../src/js-engine/index';
import {
  frozenArray, idlType, nullable, record, reference, sequence, union,
} from '../../../../src/web-idl/core/index';
import type { RealmBinding } from '../../../../src/web-idl/binding/realm';
import type { BindingContext } from '../../../../src/web-idl/binding/world';
import type { Converter } from '../../../../src/web-idl/converters/converter';

declare const binding: RealmBinding;
declare const context: BindingContext;
declare const input: unknown;
declare const iterable: object;
declare const iteratorMethod: JSMethod;

const numbersType = binding.assembly.getIDLType(sequence(idlType.long));
const numbers = binding.getConverter(numbersType);
const numericKind: 'integer' = numbers.type.elementType.kind;
const idlNumbers: number[] = numbers.jsToIDL(input);
const preparedNumbers: number[] = numbers.getJSToIDLSteps()(input);
const internalNumbers: number[] = numbers.getInputSteps()(input);
const iterableNumbers: number[] = numbers.jsToIDLIterable(iterable, iteratorMethod);
const generalConverter: Converter = numbers;
const jsNumbers: number[] = numbers.idlToJS(idlNumbers);
const preparedJSNumbers: number[] = numbers.getIDLToJSSteps()(idlNumbers);
const implNumbers: number[] = context.jsToImpl(input, sequence(idlType.long));
// @ts-expect-error Sequence conversion preserves the numeric element contract.
const wrongNumbers: string[] = numbers.jsToIDL(input);

const entries = binding.getConverter(binding.assembly.getIDLType(record(idlType.DOMString, sequence(idlType.long))));
const idlEntries: Map<string, number[]> = entries.jsToIDL(input);
const jsEntries: Record<string, number[]> = entries.idlToJS(idlEntries);
const implEntries: Record<string, number[]> = context.jsToImpl(input, record(idlType.DOMString, sequence(idlType.long)));
// @ts-expect-error Records retain their nested value contract.
const wrongEntries: Map<string, string[]> = entries.jsToIDL(input);

const nested = binding.getConverter(binding.assembly.getIDLType(sequence(record(idlType.DOMString, idlType.boolean))));
const idlNested: Map<string, boolean>[] = nested.jsToIDL(input);
const jsNested: Record<string, boolean>[] = nested.idlToJS(idlNested);

const nullableNumbers = binding.getConverter(binding.assembly.getIDLType(nullable(sequence(idlType.long))));
const idlNullable: number[] | null = nullableNumbers.jsToIDL(input);
const jsNullable: number[] | null = nullableNumbers.idlToJS(idlNullable);
const choice = binding.getConverter(binding.assembly.getIDLType(union(sequence(idlType.long), idlType.boolean)));
const idlChoice: number[] | boolean = choice.jsToIDL(input);
const jsChoice: number[] | boolean = choice.idlToJS(idlChoice);

class ItemImpl { value = 0; }
const items = binding.getConverter(binding.assembly.getIDLType(sequence(reference(ItemImpl))));
const implementations: ItemImpl[] = items.jsToIDL(input);
const platforms: object[] = items.idlToJS(implementations);
// @ts-expect-error Projected interfaces are platform objects, not their implementations.
const wrongPlatforms: ItemImpl[] = items.idlToJS(implementations);

const frozen = binding.getConverter(binding.assembly.getIDLType(frozenArray(reference(ItemImpl))));
const frozenPlatforms: readonly object[] = frozen.jsToIDL(input);
// @ts-expect-error Frozen-array IDL values already contain projected elements.
const wrongFrozen: readonly ItemImpl[] = frozen.jsToIDL(input);

// @ts-expect-error Every implementation conversion has an assembled type.
binding.implementationConverter.idlToImpl([], undefined, {}, context);
