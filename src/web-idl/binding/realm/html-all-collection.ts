import { InternalError } from '../../../infra/internal-error';
import { addon } from '../../../js-engine/index';

import type { AssembledInterface } from '../../assembly/index';
import { getImplementationRecord } from '../platform';

import type { ImplementationBinding } from './implementation';
import {
  LegacyPlatformObjectBinding, isArrayIndex, toArrayIndex, type LegacyPropertyMetadata,
} from './legacy';

/** Keep HTMLAllCollection's undetectable identity while reusing Web IDL's legacy property rules. */
// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#the-htmlallcollection-interface
export class HTMLAllCollectionBinding extends LegacyPlatformObjectBinding {
  /** Allocate the native collection and bind calls through its declared `item` operation. */
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#HTMLAllCollection-call
  allocateObject(
    implementation: object, implementationBinding: ImplementationBinding<AssembledInterface>, prototype: object,
  ): object {
    const { binding, assembled } = implementationBinding;
    const item = assembled.getOperationGroups('regular', (operation) => operation.name === 'item')
      .get('regular:item')!.callables[0]!;
    const memberBinding = implementationBinding.getOrCreateMemberBinding(item);
    const convertName = binding.getConverter(item.arguments[0]!.type).getJSToIDLSteps();
    const convertResult = binding.getConverter(item.returns).getIDLToJSSteps();
    // [[Call]] ignores thisArgument and every argument after the first. Use the
    // implementation directly, even if author code replaces the platform's item.
    const object = binding.realm.createHTMLDDA((value: unknown) => {
      if (value === undefined) return null;
      const name = convertName(value);
      return convertResult(memberBinding.operationSteps!(getImplementationRecord(implementation)!, [name]));
    });
    Object.setPrototypeOf(object, prototype);
    return this.createObject(object, implementation, implementationBinding.getLegacyPropertyMetadata());
  }

  /** Intercept virtual properties; V8 retains ordinary properties and their actual receivers. */
  override createObject(
    object: object, implementation: object, properties: LegacyPropertyMetadata | null,
  ): object {
    if (!properties) return object;
    if (!addon.setPropertyHandlers) {
      throw new InternalError('Node backend does not provide setPropertyHandlers');
    }
    const getProperty = (property: string | symbol, hasOwn: boolean): PropertyDescriptor | undefined => {
      if (typeof property === 'symbol') return;
      if (properties.indexed && isArrayIndex(property)) {
        return this.getIndexedProperty(implementation, property, properties.indexed);
      }
      if (properties.named && !hasOwn && this.namedPropertyVisible(
        object, implementation, property, properties.named, undefined, false,
      )) return this.getNamedProperty(implementation, property, properties.named);
    };
    addon.setPropertyHandlers(object, {
      has: (property, hasOwn) => getProperty(property, hasOwn) !== undefined,
      get: (property): unknown => getProperty(property, false)?.value,
      getOwnPropertyDescriptor: getProperty,
      getPropertyAttributes: (property, hasOwn) => {
        if (typeof property !== 'string') return;
        const descriptor = getProperty(property, hasOwn);
        // SPEC_CLASH(htmlallcollection-assignment): follow Web IDL/Firefox/WebKit;
        // Chromium rejects separate-receiver named writes and accepts readonly indexed writes.
        // Web IDL [[Set]] ignores named properties before assigning on Receiver.
        // V8's query must permit that; the public descriptor remains read-only,
        // and [[DefineOwnProperty]] still rejects replacement on this object.
        if (descriptor && (!properties.indexed || !isArrayIndex(property))) descriptor.writable = true;
        return descriptor;
      },
      set: (property) => {
        if (typeof property !== 'string') return;
        if (properties.indexed && isArrayIndex(property)) {
          return this.supportsIndex(implementation, toArrayIndex(property), properties.indexed) ? false : undefined;
        }
        // HTMLAllCollection has no named setter; let V8 assign on the actual receiver. Our
        // [[DefineOwnProperty]] rejects supported names only on this object.
      },
      defineProperty: (property, descriptor, hasOwn) => this.defineVirtualProperty(
        implementation, property, descriptor, properties, hasOwn,
      ),
      deleteProperty: (property, hasOwn) => {
        if (typeof property === 'string' && properties.indexed && isArrayIndex(property)) {
          return !this.supportsIndex(implementation, toArrayIndex(property), properties.indexed);
        }
        if (getProperty(property, hasOwn) === undefined) return;
        return false;
      },
      ownKeys: () => {
        const keys: string[] = [];
        if (properties.indexed) {
          const indices = [...this.getSupportedIndices(implementation, properties.indexed)];
          indices.sort((a, b) => a - b);
          for (const index of indices) keys.push(String(index));
        }
        if (properties.named) {
          const names = this.getSupportedNames(implementation, properties.named);
          for (const name of names) {
            // V8 merges ordinary own keys and removes duplicates. Their presence
            // is checked by the native callback during descriptor queries.
            if (properties.indexed && isArrayIndex(name)) continue;
            if (this.namedPropertyVisible(object, implementation, name, properties.named, names, false)) {
              keys.push(name);
            }
          }
        }
        // SPEC_CLASH(htmlallcollection-property-order): V8/Chromium merge ordinary
        // string keys before virtual names; Web IDL, Firefox and WebKit reverse them.
        return keys;
      },
    });
    return object;
  }
}
