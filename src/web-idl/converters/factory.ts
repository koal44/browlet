import type { WebIDLType } from '../core/index';

import type { WebIDLRealm } from '../environment';

import type { RealmBinding } from '../binding/realm';

import type { Converter } from './converter';
import { AsyncSequenceConverter } from './async-sequence';
import { BufferSourceConverter, bufferTypeNames } from './buffer-source';
import { CallbackFunctionConverter, CallbackInterfaceConverter } from './callback';
import { InterfaceConverter } from './interface';
import { EnumerationConverter, ProxyObjectConverter, UnsupportedConverter } from './named';
import { NullableConverter } from './nullable';
import { PromiseConverter } from './promise';
import { RecordConverter } from './record';
import { SequenceConverter, FrozenArrayConverter } from './sequence';
import { SimpleConverter } from './simple';
import { UnionConverter } from './union';

/** Select a converter once for a declared type, binding, and allocation realm. */
export function createConverter<Type extends WebIDLType>(type: Type, binding: RealmBinding, realm: WebIDLRealm): Converter<Type> {
  const assembly = binding.assembly;
  const rules = assembly.getConversionRules(type);
  const resolved = rules.resolvedType;
  switch (resolved.kind) {
    case 'simple': return bufferTypeNames.has(resolved.name)
      ? new BufferSourceConverter(rules, binding, realm) : new SimpleConverter(rules, binding, realm);
    case 'nullable': return new NullableConverter(rules, binding, realm);
    case 'sequence': return new SequenceConverter(rules, binding, realm);
    case 'frozen-array': return new FrozenArrayConverter(rules, binding, realm);
    case 'record': return new RecordConverter(rules, binding, realm);
    case 'union': return new UnionConverter(rules, binding, realm);
    case 'promise': return new PromiseConverter(rules, binding, realm);
    case 'async-sequence': return new AsyncSequenceConverter(rules, binding, realm);
    case 'observable-array': return new UnsupportedConverter(rules, binding, realm, 'Web IDL conversion for observable-array is not implemented');
    case 'reference': {
      const { name } = resolved;
      const assembled = assembly.interfaces.get(name);
      if (assembled) return new InterfaceConverter(rules, binding, realm, assembled);
      const dictionary = assembly.dictionaries.get(name);
      if (dictionary) return binding.getDictionaryConverter(dictionary, realm, rules);
      const enumeration = assembly.enumerations.get(name);
      if (enumeration) return new EnumerationConverter(rules, binding, realm, enumeration);
      const callbackFunction = assembly.callbackFunctions.get(name);
      if (callbackFunction) return new CallbackFunctionConverter(rules, binding, realm, callbackFunction);
      const callbackInterface = assembly.callbackInterfaces.get(name);
      if (callbackInterface) return new CallbackInterfaceConverter(rules, binding, realm, callbackInterface);
      const proxy = assembly.proxyObjects.get(name);
      if (proxy) return new ProxyObjectConverter(rules, binding, realm, proxy);
      return new UnsupportedConverter(rules, binding, realm, assembly.namespaces.has(name)
        ? `${name} is not a value type` : `Unknown Web IDL type ${name}`);
    }
  }
}
