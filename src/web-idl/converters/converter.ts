import {
  RangeError as InternalRangeError, SyntaxError as InternalSyntaxError, TypeError as InternalTypeError,
} from '../../infra/index';

import { isObject } from '../../js-engine/index';

import type { DefaultValue, ExtendedAttribute, SimpleTypeName, WebIDLType } from '../core/index';

import type { AssembledCallbackFunction } from '../assembled';
import type { ConversionRules, IntegerConversionMode, ResolvedType } from '../assembly';
import type { WebIDLRealm } from '../environment';

import type { RealmBinding } from '../binding/realm';

import type { IDLValue, JSValue } from '../values/index';

/** Convert one declared type using shared rules, a projection binding, and an allocation realm. */
export abstract class Converter<Type extends WebIDLType = WebIDLType> {
  /** Binding used for implementation lookup, projection, and internal exception requests. */
  binding: RealmBinding;
  /** Realm for ordinary result objects and new conversion errors; may differ from binding.realm. */
  realm: WebIDLRealm;
  /** Fixed rules prepared once by assembly and shared across bindings and realms. */
  #rules: ConversionRules<Type>;
  /** Prepared ordinary input conversion, shared by every use of this converter. */
  #input?: ConversionSteps;
  /** Public input steps, including conversion error realization. */
  #inputEntry?: ConversionSteps;
  /** Prepared output conversion that preserves existing buffer identity. */
  #output?: ConversionSteps;
  /** Cached nullable legacy callback declaration, or null when the type does not qualify. */
  #legacyCallback?: AssembledCallbackFunction | null;

  /** Retain the assembly's rules with the binding and allocation realm for this conversion. */
  constructor(rules: ConversionRules<Type>, binding: RealmBinding, realm: WebIDLRealm) {
    this.#rules = rules;
    this.binding = binding;
    this.realm = realm;
  }

  /** Original descriptor, including aliases and annotations for this declared use. */
  get declaredType(): Type { return this.#rules.declaredType; }
  /** Type used for conversion after resolving outer aliases and annotations. */
  get resolvedType(): ResolvedType { return this.#rules.resolvedType; }
  /** Conversion annotations collected from this type and its aliases. */
  get extendedAttributes(): ExtendedAttribute[] { return this.#rules.extendedAttributes; }
  /** Whether integer conversion wraps, clamps, or rejects out-of-range values. */
  get integerMode(): IntegerConversionMode { return this.#rules.integerMode; }
  /** Whether buffer conversion accepts shared backing memory. */
  get allowShared(): boolean { return this.#rules.allowShared; }
  /** Whether buffer conversion accepts resizable or growable backing memory. */
  get allowResizable(): boolean { return this.#rules.allowResizable; }
  /** Whether string conversion maps null to the empty string. */
  get nullToEmptyString(): boolean { return this.#rules.nullToEmptyString; }

  /** Nullable legacy callback declaration, used by setters to select their input converter. */
  get legacyCallback(): AssembledCallbackFunction | null {
    if (this.#legacyCallback === undefined) {
      this.#legacyCallback = this.binding.assembly.getNullableLegacyCallback(this.declaredType);
    }
    return this.#legacyCallback;
  }

  /** Select a nested type's own rules while preserving implementation and allocation ownership. */
  forType<Other extends WebIDLType>(type: Other): Converter<Other> {
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
        const numericType = this.binding.assembly.getSoleNumericTypeName(this.declaredType);
        if (numericType === 'bigint') return integer;
        if (numericType && integerTypes[numericType]) return Number(integer);
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
  jsToIDL<Declared extends WebIDLType>(this: Converter<Declared>, value: unknown): IDLValue<Declared> {
    try {
      return this.inputSteps(value) as IDLValue<Declared>;
    } catch (error) {
      return this.throwConversionError(error);
    }
  }

  /** Convert an IDL value to its author representation, realizing internal exception requests. */
  idlToJS<Declared extends WebIDLType>(this: Converter<Declared>, value: unknown): JSValue<Declared> {
    return this.getIDLToJSSteps()(value);
  }

  /** Nested input steps for converters already inside an error boundary; enter through jsToIDL(). */
  get inputSteps(): ConversionSteps {
    return this.#input ??= this.createInputSteps();
  }

  /** Retain a callable input entry point when installing members or preparing callback returns. */
  getJSToIDLSteps<Declared extends WebIDLType>(this: Converter<Declared>): ConversionSteps<IDLValue<Declared>> {
    if (!this.#inputEntry) {
      const convert = this.inputSteps;
      this.#inputEntry = (value) => {
        try { return convert(value); }
        catch (error) { return this.throwConversionError(error); }
      };
    }
    return this.#inputEntry as ConversionSteps<IDLValue<Declared>>;
  }

  /** Retain output conversion and its binding's exception realization. */
  getIDLToJSSteps<Declared extends WebIDLType>(this: Converter<Declared>): ConversionSteps<JSValue<Declared>> {
    if (!this.#output) {
      const convert = this.createOutputSteps();
      const realize = this.binding.realizeException;
      this.#output = convert ? (value) => convert(realize(value)) : realize;
    }
    return this.#output as ConversionSteps<JSValue<Declared>>;
  }

  /** Prepare the type-specific input algorithm once, without retaining incoming values. */
  protected abstract createInputSteps(): ConversionSteps;

  /** Types whose IDL and author representations coincide need no additional output steps. */
  protected createOutputSteps(): ConversionSteps | undefined { return undefined; }
}

/** Prepared conversion callable used by installed bindings and nested conversions. */
export type ConversionSteps<Result = unknown> = (value: unknown) => Result;

/** Integer conversion parameters, also used to recognize validated integer defaults. */
// https://webidl.spec.whatwg.org/#js-integer-types
export const integerTypes: Partial<Record<
  SimpleTypeName,
  { bitLength: number; signed: boolean; }
>> = {
  byte: { bitLength: 8, signed: true },
  octet: { bitLength: 8, signed: false },
  short: { bitLength: 16, signed: true },
  'unsigned short': { bitLength: 16, signed: false },
  long: { bitLength: 32, signed: true },
  'unsigned long': { bitLength: 32, signed: false },
  'long long': { bitLength: 64, signed: true },
  'unsigned long long': { bitLength: 64, signed: false },
};
