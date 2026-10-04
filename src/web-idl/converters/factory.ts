import type { WebIDLRealm } from '../environment';
import type { IDLType, IDLSequenceType, IDLFrozenArrayType } from '../assembly/index';
import type { RealmBinding } from '../binding/realm';

import type { Converter } from './converter';
import { AsyncSequenceConverter } from './async-sequence';
import { BufferSourceConverter } from './buffer-source';
import {
  AnyConverter, UndefinedConverter, BooleanConverter, BigIntConverter, ObjectConverter, SymbolConverter,
} from './builtin';
import { CallbackFunctionConverter, CallbackInterfaceConverter } from './callback';
import { FloatConverter } from './float';
import { IntegerConverter } from './integer';
import { InterfaceConverter, ProxyObjectConverter } from './interface';
import { NullableConverter } from './nullable';
import { ObservableArrayConverter } from './observable-array';
import { PromiseConverter } from './promise';
import { RecordConverter } from './record';
import { SequenceConverter, FrozenArrayConverter } from './sequence';
import { StringConverter, EnumerationConverter } from './string';
import { UnionConverter } from './union';

/** Select the converter for an assembled type, preserving its specific contract. */
export function createConverter<Type extends IDLType>(type: Type, binding: RealmBinding, realm: WebIDLRealm): ConverterFor<Type>;
export function createConverter(type: IDLType, binding: RealmBinding, realm: WebIDLRealm): Converter {
  switch (type.kind) {
    case 'any': return new AnyConverter(type, binding, realm);
    case 'undefined': return new UndefinedConverter(type, binding, realm);
    case 'boolean': return new BooleanConverter(type, binding, realm);
    case 'bigint': return new BigIntConverter(type, binding, realm);
    case 'object': return new ObjectConverter(type, binding, realm);
    case 'symbol': return new SymbolConverter(type, binding, realm);
    case 'integer': return new IntegerConverter(type, binding, realm);
    case 'float': return new FloatConverter(type, binding, realm);
    case 'string': return new StringConverter(type, binding, realm);
    case 'buffer-source': return new BufferSourceConverter(type, binding, realm);
    case 'nullable': return new NullableConverter(type, binding, realm);
    case 'sequence': return new SequenceConverter(type, binding, realm);
    case 'frozen-array': return new FrozenArrayConverter(type, binding, realm);
    case 'record': return new RecordConverter(type, binding, realm);
    case 'union': return new UnionConverter(type, binding, realm);
    case 'promise': return new PromiseConverter(type, binding, realm);
    case 'async-sequence': return new AsyncSequenceConverter(type, binding, realm);
    case 'observable-array': return new ObservableArrayConverter(type, binding, realm);
    case 'interface': return new InterfaceConverter(type, binding, realm);
    case 'dictionary': return binding.getDictionaryConverter(type, realm);
    case 'enumeration': return new EnumerationConverter(type, binding, realm);
    case 'callback-function': return new CallbackFunctionConverter(type, binding, realm);
    case 'callback-interface': return new CallbackInterfaceConverter(type, binding, realm);
    case 'proxy-object': return new ProxyObjectConverter(type, binding, realm);
  }
}

/** Sequence types additionally expose conversion using an already selected iterator method. */
export type ConverterFor<Type extends IDLType> =
  [Type] extends [IDLFrozenArrayType] ? FrozenArrayConverter<Extract<Type, IDLFrozenArrayType>>
    : [Type] extends [IDLSequenceType | IDLFrozenArrayType]
      ? SequenceConverter<Extract<Type, IDLSequenceType | IDLFrozenArrayType>>
      : Converter<Type>;
