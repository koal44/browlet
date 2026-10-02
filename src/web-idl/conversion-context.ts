import {
  RangeError as InternalRangeError, SyntaxError as InternalSyntaxError,
  TypeError as InternalTypeError,
} from '../infra/exceptions';
import type { DefaultValue, ExtendedAttribute, WebIDLType } from './core/types';
import type { ConversionRules, IntegerConversionMode, ResolvedType } from './assembly';
import type { AssembledCallbackFunction } from './assembled';
import type { WebIDLRealm } from './environment';
import type { RealmBinding } from './binding/realm';
import {
  createJSToIDLConverter, createIDLToJSConverter, jsToIDL, type IDLValue, type ValueConverter,
} from './conversion';
import { integerTypes } from './constructs/simple';

/** A declared type's conversion rules, projection binding, and allocation realm. */
export class ConversionContext<Type extends WebIDLType = WebIDLType> {
  /** Binding used for implementation lookup, projection, and internal exception requests. */
  binding: RealmBinding;
  /** Realm for ordinary result objects and new conversion errors; may differ from binding.realm. */
  realm: WebIDLRealm;
  /** Fixed rules prepared once by assembly and shared across bindings and realms. */
  #rules: ConversionRules<Type>;
  /** Prepared ordinary input conversion, shared by every use of this context. */
  #input?: ValueConverter;
  /** Prepared output conversion that preserves existing buffer identity. */
  #output?: ValueConverter;
  /** Cached nullable legacy callback declaration, or null when the type does not qualify. */
  #legacyCallback?: AssembledCallbackFunction | null;

  /** Retain the assembly's rules with the binding and allocation realm for this conversion. */
  constructor(type: Type, binding: RealmBinding, realm: WebIDLRealm) {
    this.#rules = binding.assembly.getConversionRules(type);
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
  forType<Other extends WebIDLType>(type: Other): ConversionContext<Other> {
    return this.binding.getConversionContext(type, this.realm);
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
        return jsToIDL(Number(integer), this);
      }
      case 'decimal':
        return jsToIDL(Number(value.value), this);
      case 'positive-infinity':
        return jsToIDL(Infinity, this);
      case 'negative-infinity':
        return jsToIDL(-Infinity, this);
      case 'not-a-number':
        return jsToIDL(NaN, this);
      case 'undefined':
        return undefined;
      case 'empty-sequence':
        return [];
      case 'empty-dictionary':
        return jsToIDL(undefined, this);
    }
  }

  /** Prepare and retain input conversion without retaining any converted values. */
  getJSToIDLConverter<Converted extends WebIDLType>(
    this: ConversionContext<Converted>,
  ): ValueConverter<IDLValue<Converted>> {
    const convert = this.#input ??= createJSToIDLConverter(this);
    return convert as ValueConverter<IDLValue<Converted>>;
  }

  /** Prepare and retain output conversion using this context's allocation realm. */
  getIDLToJSConverter(): ValueConverter {
    return this.#output ??= createIDLToJSConverter(this);
  }
}
