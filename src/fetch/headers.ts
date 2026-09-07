import {
  arg, ctor, defineInterface, defineTypedef, idlType, impl, iter, nullable, op,
  record, reference, sequence, union,
} from '../web-idl/declaration/index';
import { bind } from '../web-idl/projection';

/*
 * Fetch §§2.2.2 and 5.1. Names and values are byte strings: each string code
 * unit represents one byte. The list preserves order, duplicates, and identity.
 */
export type Header = [name: string, value: string];
export type HeaderList = Header[];

/*
 * typedef (sequence<sequence<ByteString>> or record<ByteString, ByteString>) HeadersInit;
 *
 * [Exposed=(Window,Worker)]
 * interface Headers {
 *   constructor(optional HeadersInit init);
 *
 *   undefined append(ByteString name, ByteString value);
 *   undefined delete(ByteString name);
 *   ByteString? get(ByteString name);
 *   sequence<ByteString> getSetCookie();
 *   boolean has(ByteString name);
 *   undefined set(ByteString name, ByteString value);
 *   iterable<ByteString, ByteString>;
 * };
 */
export class HeadersImpl {
  readonly headerList: HeaderList;
  guard: HeadersGuard;

  // Internal allocation. The author constructor's fill algorithm is deferred.
  constructor(headerList: HeaderList = [], guard: HeadersGuard = 'none') {
    this.headerList = headerList;
    this.guard = guard;
  }

  append(_name: string, _value: string): void {
    throw new Error('Headers.append is not implemented');
  }

  delete(_name: string): void {
    throw new Error('Headers.delete is not implemented');
  }

  get(_name: string): string | null {
    throw new Error('Headers.get is not implemented');
  }

  getSetCookie(): string[] {
    throw new Error('Headers.getSetCookie is not implemented');
  }

  has(_name: string): boolean {
    throw new Error('Headers.has is not implemented');
  }

  set(_name: string, _value: string): void {
    throw new Error('Headers.set is not implemented');
  }

  entries(): IterableIterator<[string, string]> {
    throw new Error('Headers sorting and combining is not implemented');
  }
}

export type HeadersGuard = 'immutable' | 'request' | 'request-no-cors' | 'response' | 'none';

/** Binding converts HeadersInit's sequence/record branches to arrays/plain objects. */
export type HeadersInitValue = string[][] | Record<string, string>;

export const headersInitIDL = defineTypedef({
  name: 'HeadersInit',
  type: union(sequence(sequence(idlType.ByteString)), record(idlType.ByteString, idlType.ByteString)),
});

export const headersIDL = defineInterface({
  name: 'Headers',
  exposed: ['Window', 'Worker'],
  implementation: impl(HeadersImpl),
  members: [
    ctor([arg('init', reference('HeadersInit'), { optional: true })], bind({
      invoke() { throw new Error('Headers construction from HeadersInit is not implemented'); },
    })),
    op('append', idlType.undefined, [arg('name', idlType.ByteString), arg('value', idlType.ByteString)]),
    op('delete', idlType.undefined, [arg('name', idlType.ByteString)]),
    op('get', nullable(idlType.ByteString), [arg('name', idlType.ByteString)]),
    op('getSetCookie', sequence(idlType.ByteString)),
    op('has', idlType.boolean, [arg('name', idlType.ByteString)]),
    op('set', idlType.undefined, [arg('name', idlType.ByteString), arg('value', idlType.ByteString)]),
    iter(idlType.ByteString, { key: idlType.ByteString }),
  ],
});
