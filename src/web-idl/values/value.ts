import type { PromiseResult } from '../../infra/index';

import type {
  IDLType, IDLNullableType, IDLUnionType, IDLSequenceType, IDLRecordType, IDLFrozenArrayType,
  IDLPromiseType, IDLAsyncSequenceType,
} from '../assembly/index';
import type { IDLAsyncSequence } from './async-sequence';
import type { IDLCallbackFunction, IDLCallbackInterface } from './callback';
import type { IDLDictionary } from './dictionary';
import type { IDLPromise } from './promise';

/** Converted sequence entries, before nested IDL values become implementation values. */
export type IDLSequence<Value = unknown> = Value[];

/** Converted record keys and values in their author-provided property order. */
export type IDLRecord<Value = unknown> = Map<string, Value>;

/** Converted keys and values backing a maplike interface. */
export type IDLMapEntries = Map<unknown, unknown>;

/** Converted entries backing a setlike interface. */
export type IDLSetEntries = Set<unknown>;

/** IDL representation selected by the compiled type, without declaration syntax. */
export type IDLValue<Type extends IDLType> =
  IDLType extends Type ? unknown
    : Type extends IDLNullableType<infer Inner> ? IDLValue<Inner> | null
      : Type extends IDLUnionType<infer Member> ? IDLValue<Member>
        : Type extends IDLSequenceType<infer Element> ? IDLSequence<IDLValue<Element>>
          : Type extends IDLRecordType<infer Value> ? IDLRecord<IDLValue<Value>>
            : Type extends IDLFrozenArrayType<infer Element> ? readonly JSValue<Element>[]
              : Type extends { kind: 'integer' | 'float'; } ? number
                : Type extends { kind: 'string' | 'enumeration'; } ? string
                  : Type extends { kind: 'undefined'; } ? undefined
                    : Type extends { kind: 'boolean'; } ? boolean
                      : Type extends { kind: 'bigint'; } ? bigint
                        : Type extends { kind: 'symbol'; } ? symbol
                          : Type extends { kind: 'buffer-source'; } ? TypedValue<Type, ArrayBufferLike | ArrayBufferView>
                            : Type extends { kind: 'interface'; } ? TypedValue<Type, object>
                              : Type extends { kind: 'object' | 'proxy-object'; } ? object
                                : Type extends { kind: 'dictionary'; } ? IDLDictionary
                                  : Type extends { kind: 'callback-function'; } ? IDLCallbackFunction
                                    : Type extends { kind: 'callback-interface'; } ? IDLCallbackInterface
                                      : Type extends IDLPromiseType<infer Result> ? IDLPromise<Result>
                                        : Type extends IDLAsyncSequenceType<infer Element> ? IDLAsyncSequence<Element>
                                          : unknown;

/** Author representation; an interface's implementation type is not its platform surface. */
export type JSValue<Type extends IDLType> =
  IDLType extends Type ? unknown
    : Type extends IDLNullableType<infer Inner> ? JSValue<Inner> | null
      : Type extends IDLUnionType<infer Member> ? JSValue<Member>
        : Type extends IDLSequenceType<infer Element> ? JSValue<Element>[]
          : Type extends IDLRecordType<infer Value> ? Record<string, JSValue<Value>>
            : Type extends IDLFrozenArrayType<infer Element> ? readonly JSValue<Element>[]
              : Type extends { kind: 'integer' | 'float'; } ? number
                : Type extends { kind: 'string' | 'enumeration'; } ? string
                  : Type extends { kind: 'undefined'; } ? undefined
                    : Type extends { kind: 'boolean'; } ? boolean
                      : Type extends { kind: 'bigint'; } ? bigint
                        : Type extends { kind: 'symbol'; } ? symbol
                          : Type extends { kind: 'buffer-source'; } ? TypedValue<Type, ArrayBufferLike | ArrayBufferView>
                            : Type extends { kind: 'promise'; } ? Promise<unknown>
                              : Type extends { kind: 'object' | 'interface' | 'proxy-object' | 'dictionary' |
                                'callback-function' | 'callback-interface' | 'async-sequence'; } ? object
                                : unknown;

// Implementation-class and buffer payloads survive compilation as value typings,
// without retaining their source descriptors.
type TypedValue<Type, Fallback> = unknown extends PromiseResult<Type> ? Fallback : PromiseResult<Type>;
