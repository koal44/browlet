import {
  RangeError as InternalRangeError, SyntaxError as InternalSyntaxError, TypeError as InternalTypeError,
} from '../../infra/index';
import { isObject } from '../../js-engine/index';
import type { DefaultValue, ExtendedAttribute } from '../core/index';

import type { WebIDLRealm } from '../environment';
import type { IDLType } from '../assembly/index';
import type { IDLValue, JSValue } from '../values/index';
import type { RealmBinding } from '../binding/realm';
import type { ConverterFor } from './factory';

/** Convert one IDL type using its projection binding and allocation realm. */
export abstract class Converter<Type extends IDLType = IDLType> {
  /** Binding used for implementation lookup, projection, and internal exception requests. */
  binding: RealmBinding;
  /** Realm for ordinary result objects and new conversion errors; may differ from binding.realm. */
  realm: WebIDLRealm;
  /** Type and applicable conversion rules, assembled once and shared across realms. */
  type: Type;
  /** Prepared ordinary input conversion, shared by every use of this converter. */
  #input?: ConversionSteps;
  /** Public input steps, including conversion error realization. */
  #inputEntry?: ConversionSteps;
  /** Prepared output conversion that preserves existing buffer identity. */
  #output?: ConversionSteps;

  /** Retain the assembly's rules with the binding and allocation realm for this conversion. */
  constructor(type: Type, binding: RealmBinding, realm: WebIDLRealm) {
    this.type = type;
    this.binding = binding;
    this.realm = realm;
  }

  /** Conversion annotations collected from this type and its aliases. */
  get extendedAttributes(): ExtendedAttribute[] { return this.type.attributes; }

  /** Select a nested type's own rules while preserving implementation and allocation ownership. */
  forType<Other extends IDLType>(type: Other): ConverterFor<Other> {
    return this.binding.getConverter(type, this.realm);
  }

  /** Throw a new TypeError in this conversion's allocation realm. */
  throwTypeError(message: string): never {
    throw new this.realm.intrinsics.typeError(message);
  }

  /** Realize internal coercion failures in this realm; preserve author-thrown exceptions. */
  throwConversionError(error: unknown): never {
    if (InternalTypeError.is(error)) throw new this.realm.intrinsics.typeError(error.message);
    if (InternalRangeError.is(error)) throw new this.realm.intrinsics.rangeError(error.message);
    if (InternalSyntaxError.is(error)) throw new this.realm.intrinsics.syntaxError(error.message);
    throw error;
  }

  /** Create a declaration's default using this type and realm, with fresh mutable values. */
  createDefault(value: DefaultValue): unknown {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
      return value;
    }

    switch (value.kind) {
      case 'integer': {
        const integer = this.binding.assembly.getIntegerLiteralValue(value);
        const numericType = this.type.candidates.soleNumeric;
        if (numericType?.kind === 'bigint') return integer;
        if (numericType?.kind === 'integer') return Number(integer);
        return this.jsToIDL(Number(integer));
      }
      case 'decimal':
        return this.jsToIDL(Number(value.value));
      case 'positive-infinity':
        return this.jsToIDL(Infinity);
      case 'negative-infinity':
        return this.jsToIDL(-Infinity);
      case 'not-a-number':
        return this.jsToIDL(NaN);
      case 'undefined':
        return undefined;
      case 'empty-sequence':
        return [];
      case 'empty-dictionary':
        return this.jsToIDL(undefined);
    }
  }

  /** Prepare a default once; mutable defaults are recreated on every invocation. */
  createDefaultSteps(value: DefaultValue): () => unknown {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return () => value;
    if (value.kind === 'empty-sequence') return () => [];
    if (value.kind === 'empty-dictionary') return () => this.createDefault(value);
    let initialized = false;
    let result: unknown;
    return () => {
      if (!initialized) {
        result = this.createDefault(value);
        // Do not throw before an invocation actually uses the default.
        initialized = !isObject(result);
      }
      return result;
    };
  }

  /** Enter author-to-IDL conversion here to realize coercion failures in this realm. */
  // https://webidl.spec.whatwg.org/#js-type-mapping
  jsToIDL<ValueType extends IDLType>(this: Converter<ValueType>, value: unknown): IDLValue<ValueType> {
    try {
      return this.getInputSteps()(value);
    } catch (error) {
      return this.throwConversionError(error);
    }
  }

  /** Convert an IDL value to its author representation using its declared type. */
  idlToJS<ValueType extends IDLType>(this: Converter<ValueType>, value: unknown): JSValue<ValueType> {
    return this.getIDLToJSSteps()(value);
  }

  /** Nested input steps for converters already inside an error boundary; enter through jsToIDL(). */
  getInputSteps<ValueType extends IDLType>(this: Converter<ValueType>): ConversionSteps<IDLValue<ValueType>> {
    return (this.#input ??= this.createInputSteps()) as ConversionSteps<IDLValue<ValueType>>;
  }

  /** Retain a callable input entry point when installing members or preparing callback returns. */
  getJSToIDLSteps<ValueType extends IDLType>(this: Converter<ValueType>): ConversionSteps<IDLValue<ValueType>> {
    if (!this.#inputEntry) {
      const convert = this.getInputSteps();
      this.#inputEntry = (value) => {
        try { return convert(value); }
        catch (error) { return this.throwConversionError(error); }
      };
    }
    return this.#inputEntry as ConversionSteps<IDLValue<ValueType>>;
  }

  /** Retain output conversion; arbitrary object converters also realize exception values. */
  getIDLToJSSteps<ValueType extends IDLType>(this: Converter<ValueType>): ConversionSteps<JSValue<ValueType>> {
    this.#output ??= this.createOutputSteps() ?? ((value) => value);
    return this.#output as ConversionSteps<JSValue<ValueType>>;
  }

  /** Prepare the type-specific input algorithm once, without retaining incoming values. */
  protected abstract createInputSteps(): ConversionSteps;

  /** Types whose IDL and author representations coincide need no additional output steps. */
  protected createOutputSteps(): ConversionSteps | undefined { return undefined; }
}

/** Prepared conversion callable used by installed bindings and nested conversions. */
export type ConversionSteps<Result = unknown> = (value: unknown) => Result;
