import type { PromiseResult } from '../../infra/index';

import type { WebIDLType } from '../core/index';

import type { IDLAsyncSequence } from './async-sequence';
import type { IDLPromise } from './promise';

/** Converted sequence entries, before nested IDL values become implementation values. */
export type IDLSequence = unknown[];

/** Converted record keys and values in their author-provided property order. */
export type IDLRecord = Map<string, unknown>;

/** Converted keys and values backing a maplike interface. */
export type IDLMapEntries = Map<unknown, unknown>;

/** Converted entries backing a setlike interface. */
export type IDLSetEntries = Set<unknown>;

// Implementation payload types describe the final representation, not intermediate
// IDL values. Use them only where those representations coincide. A name alone
// needs the runtime assembly, and a fully dynamic WebIDLType can denote any.
/** IDL representation associated with a declared type, before implementation conversion. */
export type IDLValue<Type extends WebIDLType> =
  WebIDLType extends Type ? unknown
    : Type extends { kind: 'annotated'; type: infer Inner extends WebIDLType; } ? IDLValue<Inner>
      : Type extends { kind: 'simple' | 'interface'; } ? PromiseResult<Type>
        : Type extends { kind: 'sequence'; } ? IDLSequence
          : Type extends { kind: 'record'; } ? IDLRecord
            : Type extends { kind: 'promise'; } ? IDLPromise
              : Type extends { kind: 'async-sequence'; } ? IDLAsyncSequence
                : Type extends { kind: 'frozen-array'; } ? readonly unknown[]
                  : unknown;

/** Author result shapes known without resolving names or assuming an implementation is a platform object. */
export type JSValue<Type extends WebIDLType> =
  WebIDLType extends Type ? unknown
    : Type extends { kind: 'annotated'; type: infer Inner extends WebIDLType; } ? JSValue<Inner>
      : Type extends { kind: 'simple'; } ? PromiseResult<Type>
        : Type extends { kind: 'sequence'; } ? unknown[]
          : Type extends { kind: 'frozen-array'; } ? readonly unknown[]
            : Type extends { kind: 'record' | 'async-sequence'; } ? object
              : Type extends { kind: 'promise'; } ? Promise<unknown>
                : unknown;
