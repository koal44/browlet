import { internalType, type InternalPromise } from '../../../../src/infra/promises';
import { idlType, implementationType, nullable, reference, sequence } from '../../../../src/web-idl/core/index';

declare const P: typeof InternalPromise;

const bytes = P.withResolvers(idlType.Uint8Array);
bytes.resolve(new Uint8Array());
// @ts-expect-error The result type is selected by the descriptor, not a separate generic.
P.withResolvers<string>(idlType.Uint8Array);
// @ts-expect-error Untyped creation is unavailable.
P.withResolvers<Uint8Array>();
// @ts-expect-error Static resolution cannot infer a wider payload from the value.
P.resolve('wrong', idlType.Uint8Array);
// @ts-expect-error The descriptor also constrains a synchronous operation's result.
P.try(() => 'wrong', idlType.Uint8Array);
// @ts-expect-error Native import conversion must return the declared result.
P.fromNative(Promise.resolve('wrong'), String, idlType.Uint8Array);
// @ts-expect-error JavaScript adoption cannot contradict the result descriptor.
P.fromValue('wrong', Promise, idlType.Uint8Array);
const joined: InternalPromise<Uint8Array[]> = P.all([bytes.promise], sequence(idlType.Uint8Array));
// @ts-expect-error all requires the complete array result descriptor.
P.all([bytes.promise], idlType.Uint8Array);
// @ts-expect-error all constrains inputs to the result array's element type.
P.all([P.resolve('wrong', idlType.DOMString)], sequence(idlType.Uint8Array));
// @ts-expect-error This resolver accepts bytes.
bytes.resolve('bytes');
const copied: InternalPromise<Uint8Array> = bytes.promise.then((value) => value.slice());
// @ts-expect-error Changing the result type requires its descriptor.
bytes.promise.then(() => 'changed');
const text: InternalPromise<string> = bytes.promise.then(() => 'changed', undefined, idlType.DOMString);
// Different IDL contracts can have the same TypeScript payload type.
text.then((value) => value, undefined, idlType.USVString);
// @ts-expect-error The second argument is reserved for the rejection handler.
text.then((value) => value, idlType.USVString);
bytes.promise.then(() => 'changed', () => 'recovered', idlType.DOMString);
bytes.promise.then(undefined, () => new Uint8Array());
// @ts-expect-error A callback must produce the descriptor's result type.
bytes.promise.then(() => 7, undefined, idlType.DOMString);
// @ts-expect-error Returning another Promise cannot silently change the result type.
bytes.promise.then(() => text);
// @ts-expect-error Recovery also needs a descriptor when it changes the result type.
bytes.promise.then(undefined, () => 'recovered');
// @ts-expect-error Both callbacks must produce the selected descriptor's result type.
bytes.promise.then(() => 'changed', () => 7, idlType.DOMString);
void copied;
void joined;

type Result = { value: number; done: boolean; };
const resultType = implementationType<Result>(reference('Result'));
P.resolve({ value: 1, done: false }, resultType);
// @ts-expect-error Dictionary payloads retain their concrete implementation contract.
P.resolve({ value: 1 }, resultType);
// @ts-expect-error A wrong dictionary member cannot widen the selected result type.
bytes.promise.then(() => ({ value: 'wrong', done: false }), undefined, resultType);
P.resolve(null, nullable(resultType));
P.resolve([{ value: 1, done: false }], sequence(resultType));
// @ts-expect-error Nested descriptors preserve their item type.
P.resolve([{ value: 'wrong', done: false }], sequence(resultType));
// @ts-expect-error A named IDL reference needs its implementation association.
P.withResolvers(reference('Result'));

const queueType = internalType<Result>('QueueResult');
P.resolve({ value: 1, done: true }, queueType);
// @ts-expect-error Implementation-only values also have a selected contract.
P.resolve({ value: 'wrong', done: true }, queueType);
