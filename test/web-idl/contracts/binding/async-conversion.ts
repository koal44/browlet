import type { AsyncIterator, InternalPromise } from '../../../../src/infra/index';
import { asyncSequence, idlType, promise, record, reference, sequence } from '../../../../src/web-idl/core/index';
import type { IDLIntegerType, IDLSequenceType } from '../../../../src/web-idl/assembly/index';
import type { BindingContext } from '../../../../src/web-idl/binding/context';
import type { RealmBinding } from '../../../../src/web-idl/binding/realm';

declare const binding: RealmBinding;
declare const context: BindingContext;
declare const input: unknown;

const promisedNumbers = binding.assembly.getIDLType(promise(sequence(idlType.long)));
const resultType: IDLSequenceType<IDLIntegerType> = promisedNumbers.resultType;
const promiseConverter = binding.getConverter(promisedNumbers);
const retainedPromise = promiseConverter.jsToIDL(input);
const retainedResultType: IDLSequenceType<IDLIntegerType> = retainedPromise.type;
const implementationPromise: InternalPromise<number[]> = binding.implementationConverter.idlToImpl(
  retainedPromise, promisedNumbers, {}, context,
);
const preparedPromise: InternalPromise<number[]> = binding.implementationConverter.createConverter(promisedNumbers, {})(retainedPromise, context);
const publicPromise: Promise<unknown> = promiseConverter.idlToJS(retainedPromise);
// @ts-expect-error Native fulfillment has not yet undergone the declared conversion.
const prematureResult: Promise<number[]> = retainedPromise.promise;
// @ts-expect-error Returning an incoming IDL promise preserves its raw native fulfillment.
const prematureOutput: Promise<number[]> = promiseConverter.idlToJS(retainedPromise);
const contextPromise: InternalPromise<number[]> = context.jsToImpl(input, promise(sequence(idlType.long)));
const recordPromise: InternalPromise<Record<string, number>> = context.jsToImpl(input, promise(record(idlType.DOMString, idlType.long)));

const asyncNumbers = binding.assembly.getIDLType(asyncSequence(sequence(idlType.long)));
const elementType: IDLSequenceType<IDLIntegerType> = asyncNumbers.elementType;
const retainedSequence = binding.getConverter(asyncNumbers).jsToIDL(input);
const retainedElementType: IDLSequenceType<IDLIntegerType> = retainedSequence.elementType;
const openedElementType: IDLSequenceType<IDLIntegerType> = retainedSequence.open(binding.realm).elementType;
const iterator: AsyncIterator<number[]> = binding.implementationConverter.idlToImpl(retainedSequence, asyncNumbers, {}, context);
const preparedIterator: AsyncIterator<number[]> = binding.implementationConverter.createConverter(asyncNumbers, {})(retainedSequence, context);
const contextIterator: AsyncIterator<number[]> = context.jsToImpl(input, asyncSequence(sequence(idlType.long)));
class ItemImpl { value = 1; }
const items: AsyncIterator<ItemImpl[]> = context.jsToImpl(input, asyncSequence(sequence(reference(ItemImpl))));
// @ts-expect-error The iterator's element contract is preserved in its implementation view.
const wrongElements: AsyncIterator<string[]> = iterator;
