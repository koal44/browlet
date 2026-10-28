import { InternalError } from '../../../infra/index';
import { isCallable } from '../../../js-engine/index';
import {
  isArrayIndex, type AssembledInterface, type BindingContext, type ExtendedAttribute,
  type PlatformRecord, type SecurityCheckBinding, type SecurityCheckType,
} from '../../../web-idl/index';
import { areSameOriginDomain } from '../../../url/index';

import type { BrowletEnvironment } from '../../environment';

/** HTML's cross-origin algorithms for interfaces marked [CrossOriginObject]. */
// BINDING_INTEGRATION: Owns platform descriptors and invokes the original Web IDL member steps.
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#cross-origin-objects
export class CrossOriginObjectBinding {
  // Each record fixes O and its relevant settings; the remaining keys are current settings and P.
  // Weak keys retain cached function identity while both the object and caller remain observable.
  static #descriptorMaps = new WeakMap<Readonly<PlatformRecord>, CrossOriginPropertyDescriptorMap>();

  #context: BindingContext<BrowletEnvironment>;

  constructor(context: BindingContext<BrowletEnvironment>) {
    this.#context = context;
  }

  /** Whether a string is one of Window's cross-origin names, including array indices. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#cross-origin-accessible-window-property-name
  isCrossOriginAccessibleWindowPropertyName(name: string): boolean {
    const properties = prepareCrossOriginObject(this.#context.resolveInterface('Window'))!;
    return properties.some((entry) => entry.property === name) || isArrayIndex(name);
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#crossoriginproperties-(-o-)
  crossOriginProperties(object: object): readonly CrossOriginProperty[] {
    const record = this.#requireRecord(object);
    return prepareCrossOriginObject(record.assembled)!;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#crossoriginpropertyfallback-(-p-)
  crossOriginPropertyFallback(property: PropertyKey): PropertyDescriptor {
    if (fallbackKeys.includes(property)) {
      return { value: undefined, writable: false, enumerable: false, configurable: true };
    }
    throw new this.#context.DOMException('Cross-origin property is not accessible', 'SecurityError');
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#isplatformobjectsameorigin-(-o-)
  isPlatformObjectSameOrigin(object: object): boolean {
    const record = this.#requireRecord(object);
    // getObjectRecord checks world identity; Browlet composes this world with Browlet environments.
    const targetEnv = record.binding.getEnvironment() as BrowletEnvironment;
    return areSameOriginDomain(this.#context.getEnvironment().origin, targetEnv.origin);
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#crossorigingetownpropertyhelper-(-o,-p-)
  crossOriginGetOwnPropertyHelper(object: object, property: PropertyKey): PropertyDescriptor | undefined {
    const entry = this.crossOriginProperties(object).find((entry) => entry.property === property);
    if (!entry) return undefined;

    const record = this.#requireRecord(object);
    let callers = CrossOriginObjectBinding.#descriptorMaps.get(record);
    if (!callers) CrossOriginObjectBinding.#descriptorMaps.set(record, callers = new WeakMap());
    const env = this.#context.getEnvironment();
    let descriptors = callers.get(env);
    if (!descriptors) callers.set(env, descriptors = new Map<PropertyKey, PropertyDescriptor>());
    const cached = descriptors.get(property);
    if (cached) return cached;

    // TODO(HTML 7.2.4): Supply OrdinaryGetOwnProperty access when Location gains exotic traps.
    // O is the ordinary Window/Location target, never its exotic forwarding proxy.
    const original = Reflect.getOwnPropertyDescriptor(object, property);
    let descriptor: PropertyDescriptor;
    if (entry.needsGetter === undefined && entry.needsSetter === undefined) {
      if (!original) {
        throw new InternalError(`Missing ${record.assembled.name}.${entry.property} property`);
      }
      const value: unknown = isCallable(original.value)
        ? this.#createMemberFunction(record, entry.property, 'method')
        : original.value;
      descriptor = { value, writable: false, enumerable: false, configurable: true };
    } else {
      descriptor = {
        get: entry.needsGetter ? this.#createMemberFunction(record, entry.property, 'getter') : undefined,
        set: entry.needsSetter ? this.#createMemberFunction(record, entry.property, 'setter') : undefined,
        enumerable: false,
        configurable: true,
      };
    }
    descriptors.set(property, descriptor);
    return descriptor;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#crossoriginget-(-o,-p,-receiver-)
  crossOriginGet(object: object, property: PropertyKey, receiver: unknown): unknown {
    const descriptor = Reflect.getOwnPropertyDescriptor(object, property);
    if (!descriptor) throw new InternalError('CrossOriginGet requires an own property descriptor');
    if ('value' in descriptor) return descriptor.value;
    if (!descriptor.get) throw new this.#context.DOMException('Cross-origin property is not readable', 'SecurityError');
    return Reflect.apply(descriptor.get, receiver, []);
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#crossoriginset-(-o,-p,-v,-receiver-)
  crossOriginSet(object: object, property: PropertyKey, value: unknown, receiver: unknown): boolean {
    const descriptor = Reflect.getOwnPropertyDescriptor(object, property);
    if (!descriptor) throw new InternalError('CrossOriginSet requires an own property descriptor');
    if (!descriptor.set) throw new this.#context.DOMException('Cross-origin property is not writable', 'SecurityError');
    Reflect.apply(descriptor.set, receiver, [value]);
    return true;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#crossoriginownpropertykeys-(-o-)
  crossOriginOwnPropertyKeys(object: object): PropertyKey[] {
    return [...this.crossOriginProperties(object).map((entry) => entry.property), ...fallbackKeys];
  }

  #getRecord(object: object): Readonly<PlatformRecord> | undefined {
    const record = this.#context.getObjectRecord(object);
    if (record?.platformObject !== object) return undefined;
    return prepareCrossOriginObject(record.assembled) === null ? undefined : record;
  }

  #requireRecord(object: object): Readonly<PlatformRecord> {
    const record = this.#getRecord(object);
    if (!record) throw new InternalError('Cross-origin algorithms require a [CrossOriginObject] platform object');
    return record;
  }

  #createMemberFunction(record: Readonly<PlatformRecord>, property: string, type: SecurityCheckType) {
    const method = this.#context.createMemberFunction(record.assembled.name, property, type);
    if (!method) throw new InternalError(`Missing ${record.assembled.name}.${property} IDL ${type}`);
    return method;
  }
}

/** Prepare HTML's invocation policy once; the invoking binding supplies the current realm. */
// BINDING_INTEGRATION: HTML owns origin policy; Web IDL supplies the platform receiver and invoking binding.
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#perform-a-security-check
export function prepareCrossOriginSecurityCheck(
  assembled: AssembledInterface,
): SecurityCheckBinding<BrowletEnvironment> | undefined {
  const properties = prepareCrossOriginObject(assembled);
  if (properties === null) return;
  return (context, receiver, identifier, type) => {
    for (const entry of properties) {
      if (entry.property !== identifier) continue;
      if (type === 'method' && entry.needsGetter === undefined && entry.needsSetter === undefined) return;
      if (type === 'getter' && entry.needsGetter) return;
      if (type === 'setter' && entry.needsSetter) return;
    }
    // BindingWorld checks the environment contract for every registered realm.
    const targetEnv = receiver.binding.getEnvironment() as BrowletEnvironment;
    if (!areSameOriginDomain(context.getEnvironment().origin, targetEnv.origin)) {
      throw new context.DOMException('Cross-origin access is denied', 'SecurityError');
    }
  };
}

/** Prepare HTML's interface and member annotations once for an immutable assembled interface. */
export function prepareCrossOriginObject(assembled: AssembledInterface): readonly CrossOriginProperty[] | null {
  const cached = interfaceProperties.get(assembled);
  if (cached !== undefined) return cached;
  const annotation = findAnnotation(assembled.primary.extendedAttributes, 'CrossOriginObject');
  if (!annotation) {
    interfaceProperties.set(assembled, null);
    return null;
  }
  if (annotation.kind !== 'no-arguments') throw new InternalError('[CrossOriginObject] takes no arguments');
  const properties = collectCrossOriginProperties(assembled.members.map((entry) => entry.member));
  interfaceProperties.set(assembled, properties);
  return properties;
}

type CrossOriginProperty = { property: string; needsGetter?: boolean; needsSetter?: boolean; };
type CrossOriginPropertyDescriptorMap = WeakMap<BrowletEnvironment, Map<PropertyKey, PropertyDescriptor>>;
type CrossOriginMember = { kind: string; name?: string; static?: boolean; extendedAttributes?: ExtendedAttribute[]; };

const interfaceProperties = new WeakMap<AssembledInterface, readonly CrossOriginProperty[] | null>();
const fallbackKeys: PropertyKey[] = ['then', Symbol.toStringTag, Symbol.hasInstance, Symbol.isConcatSpreadable];

function collectCrossOriginProperties(members: Iterable<CrossOriginMember>): CrossOriginProperty[] {
  const properties = new Map<string, CrossOriginProperty>();
  for (const member of members) {
    const annotation = findAnnotation(member.extendedAttributes, 'CrossOrigin');
    if (!annotation) continue;
    if ((member.kind !== 'attribute' && member.kind !== 'operation') || member.static || !member.name) {
      throw new InternalError('[CrossOrigin] requires a named instance attribute or operation');
    }
    let property: CrossOriginProperty;
    if (member.kind === 'operation') {
      if (annotation.kind !== 'no-arguments') throw new InternalError('An operation uses [CrossOrigin] without arguments');
      property = { property: member.name };
    } else {
      const access = annotation.kind === 'no-arguments' ? ['Getter']
        : annotation.kind === 'identifier' ? [annotation.value]
          : annotation.kind === 'identifier-list' ? annotation.values : [];
      if (access.length === 0 || access.some((value) => value !== 'Getter' && value !== 'Setter')) {
        throw new InternalError('[CrossOrigin] attribute permissions must be Getter and/or Setter');
      }
      property = { property: member.name, needsGetter: access.includes('Getter'), needsSetter: access.includes('Setter') };
    }
    const existing = properties.get(member.name);
    if (existing && (existing.needsGetter !== property.needsGetter || existing.needsSetter !== property.needsSetter)) {
      throw new InternalError(`Conflicting [CrossOrigin] declarations for ${member.name}`);
    }
    properties.set(member.name, property);
  }
  return [...properties.values()];
}

function findAnnotation(attributes: ExtendedAttribute[] | undefined, name: string) {
  return attributes?.find((attribute) => attribute.kind !== 'raw' && attribute.name === name);
}
