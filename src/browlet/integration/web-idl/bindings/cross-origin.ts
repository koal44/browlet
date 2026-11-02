import { InternalError } from '../../../../infra/index';
import { isCallable, isDataDescriptor } from '../../../../js-engine/index';
import {
  isArrayIndex, type AssembledInterface, type BindingContext, type ExtendedAttribute,
  type PlatformRecord, type SecurityCheckBinding, type SecurityCheckType,
} from '../../../../web-idl/index';
import { areSameOrigin, areSameOriginDomain, type Origin } from '../../../../url/index';

import { OpenerPolicy, type OpenerPolicyAccessReportParams } from '../../../browsing/policy/index';
import type { WindowProxyHandle } from '../../../browsing/window/index';
import type { BrowletEnvironment } from '../../../environment/index';
import type { BrowsingContext } from '../../../browsing/navigation/index';

/** HTML's cross-origin algorithms for interfaces marked [CrossOriginObject]. */
// BINDING_INTEGRATION: Owns platform descriptors and invokes the original Web IDL member steps.
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#cross-origin-objects
export class CrossOriginObjectBinding {
  // Each record fixes O and its relevant settings; the remaining keys are current settings and P.
  // Weak keys retain cached function identity while both the object and caller remain observable.
  static #descriptorMaps = new WeakMap<Readonly<PlatformRecord>, CrossOriginPropertyDescriptorMap>();

  /** Binding of the realm performing the internal operation. */
  #context: BindingContext<BrowletEnvironment>;

  constructor(context: BindingContext<BrowletEnvironment>) {
    this.#context = context;
  }

  /** Look up a proxy's own descriptor in this caller's realm, using its current Window. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-getownproperty
  // SPEC_MISMATCH: WindowProxy.[[GetOwnProperty]] (P)
  getWindowProxyOwnProperty(property: string | symbol, proxy: WindowProxyHandle): PropertyDescriptor | undefined {
    const window = proxy.associatedWindow;
    const implementation = proxy.windowImplementation;
    if (typeof property === 'string' && isArrayIndex(property)) {
      const child = implementation.getAssociatedDocument().getIndexedChildNavigable(Number(property));
      if (child !== undefined) {
        return { value: child.activeWindowProxy.platform, writable: false, enumerable: true, configurable: true };
      }
      if (this.isPlatformObjectSameOrigin(window)) return undefined;
      throw new this.#context.DOMException('Cross-origin index is not accessible', 'SecurityError');
    }
    if (this.isPlatformObjectSameOrigin(window)) return Reflect.getOwnPropertyDescriptor(window, property);
    const descriptor = this.crossOriginGetOwnPropertyHelper(window, property);
    if (descriptor !== undefined) return descriptor;
    if (typeof property === 'string' && implementation.getChildNavigableTargetNames().has(property)) {
      // Membership in the child-name set guarantees a WindowProxy result.
      const child = implementation.getNamedProperty(property) as WindowProxyHandle;
      return { value: child.platform, writable: false, enumerable: false, configurable: true };
    }
    return this.crossOriginPropertyFallback(property);
  }

  /** Define an own property from a descriptor record, using this caller and the proxy's current Window. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-defineownproperty
  // SPEC_MISMATCH: WindowProxy.[[DefineOwnProperty]] (P, Desc)
  defineWindowProxyOwnProperty(
    property: string | symbol,
    descriptor: PropertyDescriptor,
    proxy: WindowProxyHandle,
  ): boolean {
    const window = proxy.associatedWindow;
    if (!this.isPlatformObjectSameOrigin(window)) {
      throw new this.#context.DOMException('Cross-origin property definition is denied', 'SecurityError');
    }
    if (typeof property === 'string' && isArrayIndex(property)) return false;
    return Reflect.defineProperty(window, property, descriptor);
  }

  /** Read a proxy from this Window caller, preserving the supplied receiver. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-get
  // SPEC_MISMATCH: WindowProxy.[[Get]] (P, Receiver)
  getWindowProxy(property: string | symbol, receiver: unknown, proxy: WindowProxyHandle): unknown {
    const window = proxy.associatedWindow;
    const callerRealm = this.#context.getEnvironment().realm;
    if (!callerRealm.isWindow()) throw new InternalError('WindowProxy Get requires a Window caller');
    this.checkAccessShouldBeReported(
      callerRealm.windowImplementation.browsingContext!, proxy.windowImplementation.browsingContext!, property,
    );
    const sameOrigin = this.isPlatformObjectSameOrigin(window);
    const descriptor = this.getWindowProxyOwnProperty(property, proxy);
    if (!sameOrigin) return this.#crossOriginGetWithDescriptor(descriptor, receiver);

    // OrdinaryGet must use the proxy's descriptor, then continue at the Window prototype.
    // https://tc39.es/ecma262/#sec-ordinaryget
    if (descriptor === undefined) {
      const parent = Reflect.getPrototypeOf(window);
      return parent === null ? undefined : Reflect.get(parent, property, receiver);
    }
    if (isDataDescriptor(descriptor)) return descriptor.value;
    if (!descriptor.get) return undefined;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Supply the descriptor's receiver explicitly.
    return Reflect.apply(descriptor.get, receiver, []);
  }

  /** Write a proxy from this Window caller, preserving the supplied value and receiver. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-set
  // SPEC_MISMATCH: WindowProxy.[[Set]] (P, V, Receiver)
  setWindowProxy(property: string | symbol, value: unknown, receiver: unknown, proxy: WindowProxyHandle): boolean {
    const window = proxy.associatedWindow;
    const callerRealm = this.#context.getEnvironment().realm;
    if (!callerRealm.isWindow()) throw new InternalError('WindowProxy Set requires a Window caller');
    this.checkAccessShouldBeReported(
      callerRealm.windowImplementation.browsingContext!, proxy.windowImplementation.browsingContext!, property,
    );
    if (this.isPlatformObjectSameOrigin(window)) {
      if (typeof property === 'string' && isArrayIndex(property)) return false;
      // Unlike Get, OrdinarySet operates on the underlying Window.
      return Reflect.set(window, property, value, receiver);
    }
    return this.#crossOriginSetWithDescriptor(this.getWindowProxyOwnProperty(property, proxy), value, receiver);
  }

  /** Delete an own property using this caller and the proxy's current Window. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-delete
  // SPEC_MISMATCH: WindowProxy.[[Delete]] (P)
  deleteWindowProxyProperty(property: string | symbol, proxy: WindowProxyHandle): boolean {
    const window = proxy.associatedWindow;
    if (!this.isPlatformObjectSameOrigin(window)) {
      throw new this.#context.DOMException('Cross-origin property deletion is denied', 'SecurityError');
    }
    if (typeof property === 'string' && isArrayIndex(property)) {
      return this.getWindowProxyOwnProperty(property, proxy) === undefined;
    }
    return Reflect.deleteProperty(window, property);
  }

  /** List a proxy's own keys using this caller and the current Window's child navigables. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-ownpropertykeys
  // SPEC_MISMATCH: WindowProxy.[[OwnPropertyKeys]] ()
  getWindowProxyOwnPropertyKeys(proxy: WindowProxyHandle): (string | symbol)[] {
    const window = proxy.associatedWindow;
    const maxProperties = proxy.windowImplementation.getAssociatedDocument().getDocumentTreeChildNavigables().length;
    const keys: (string | symbol)[] = [];
    for (let index = 0; index < maxProperties; index++) keys.push(String(index));
    const tail = this.isPlatformObjectSameOrigin(window)
      ? Reflect.ownKeys(window) : this.crossOriginOwnPropertyKeys(window);
    return keys.concat(tail);
  }

  /** Resolve this caller's Location prototype from its ordinary [[Prototype]] input. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#location-getprototypeof
  // SPEC_MISMATCH: Location.[[GetPrototypeOf]] ()
  getLocationPrototypeOf(location: object, ordinaryPrototype: object | null): object | null {
    // The engine must supply ordinary storage without re-entering the exotic operation.
    return this.isPlatformObjectSameOrigin(location) ? ordinaryPrototype : null;
  }

  /** Compare with the caller-visible prototype without changing Location's ordinary storage. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#location-setprototypeof
  // SPEC_MISMATCH: Location.[[SetPrototypeOf]] (V)
  setLocationPrototypeOf(prototype: object | null, location: object, ordinaryPrototype: object | null): boolean {
    // SPEC_CLASH(location-foreign-prototype): follow HTML's visible-null comparison; Chromium throws for foreign proposals.
    // https://tc39.es/ecma262/#sec-set-immutable-prototype
    return prototype === this.getLocationPrototypeOf(location, ordinaryPrototype);
  }

  /** Select Location's own descriptor without recursively reading its public exotic object. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#location-getownproperty
  // SPEC_MISMATCH: Location.[[GetOwnProperty]] (P)
  getLocationOwnProperty(property: string | symbol, location: object, storage: object): PropertyDescriptor | undefined {
    // SPEC_CLASH(location-default-properties): retain browser nonconfigurable defaults, instead of HTML's configurable view.
    if (this.isPlatformObjectSameOrigin(location)) return Reflect.getOwnPropertyDescriptor(storage, property);
    return this.crossOriginGetOwnPropertyHelper(location, property, storage) ?? this.crossOriginPropertyFallback(property);
  }

  /** Define a same-origin Location property in its sole ordinary store. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#location-defineownproperty
  // SPEC_MISMATCH: Location.[[DefineOwnProperty]] (P, Desc)
  defineLocationOwnProperty(
    property: string | symbol, descriptor: PropertyDescriptor, location: object, storage: object,
  ): boolean {
    if (!this.isPlatformObjectSameOrigin(location)) {
      throw new this.#context.DOMException('Cross-origin property definition is denied', 'SecurityError');
    }
    // SPEC_CLASH(location-default-properties): ordinary rules accept compatible no-op redefinitions; HTML rejects all initial keys.
    return Reflect.defineProperty(storage, property, descriptor);
  }

  /** Read Location with the supplied receiver and the accessing realm's ordinary Get. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#location-get
  // SPEC_MISMATCH: Location.[[Get]] (P, Receiver)
  getLocation(property: string | symbol, receiver: unknown, location: object, storage: object): unknown {
    if (this.isPlatformObjectSameOrigin(location)) return this.#context.realm.reflectGet(storage, property, receiver);
    return this.#crossOriginGetWithDescriptor(this.getLocationOwnProperty(property, location, storage), receiver);
  }

  /** Write Location without changing the receiver or the realm used for nested property operations. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#location-set
  // SPEC_MISMATCH: Location.[[Set]] (P, V, Receiver)
  setLocation(property: string | symbol, value: unknown, receiver: unknown, location: object, storage: object): boolean {
    if (this.isPlatformObjectSameOrigin(location)) return this.#context.realm.reflectSet(storage, property, value, receiver);
    return this.#crossOriginSetWithDescriptor(this.getLocationOwnProperty(property, location, storage), value, receiver);
  }

  /** Delete only same-origin ordinary properties; frozen defaults retain their accepted browser behavior. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#location-delete
  // SPEC_MISMATCH: Location.[[Delete]] (P)
  deleteLocationProperty(property: string | symbol, location: object, storage: object): boolean {
    if (!this.isPlatformObjectSameOrigin(location)) {
      throw new this.#context.DOMException('Cross-origin property deletion is denied', 'SecurityError');
    }
    // SPEC_CLASH(location-default-properties): browser defaults remain nonconfigurable and cannot be deleted.
    return Reflect.deleteProperty(storage, property);
  }

  /** Enumerate Location's ordinary keys or its specified foreign names and fallback symbols. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#location-ownpropertykeys
  // SPEC_MISMATCH: Location.[[OwnPropertyKeys]] ()
  getLocationOwnPropertyKeys(location: object, storage: object): (string | symbol)[] {
    return this.isPlatformObjectSameOrigin(location) ? Reflect.ownKeys(storage) : this.crossOriginOwnPropertyKeys(location);
  }

  /** OrdinaryHasProperty using Location's selected own descriptor and visible prototype. */
  // https://tc39.es/ecma262/#sec-ordinaryhasproperty
  // SPEC_MISMATCH: OrdinaryHasProperty (O, P)
  hasLocationProperty(property: string | symbol, location: object, storage: object): boolean {
    if (this.getLocationOwnProperty(property, location, storage) !== undefined) return true;
    const prototype = this.getLocationPrototypeOf(location, Reflect.getPrototypeOf(storage));
    return prototype !== null && this.#context.realm.reflectHas(prototype, property);
  }

  /** Whether a string is one of Window's cross-origin names, including array indices. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#cross-origin-accessible-window-property-name
  isCrossOriginAccessibleWindowPropertyName(name: string): boolean {
    const properties = prepareCrossOriginObject(this.#context.resolveInterface('Window'))!;
    return properties.some((entry) => entry.property === name) || isArrayIndex(name);
  }

  /** Check a WindowProxy access using this caller binding's declarations and environment. */
  // https://html.spec.whatwg.org/multipage/browsers.html#coop-check-access-report
  // SPEC_MISMATCH: check if an access between two browsing contexts should be reported (accessor, accessed, P, environment)
  checkAccessShouldBeReported(accessor: BrowsingContext, accessed: BrowsingContext, property: string | symbol): void {
    if (typeof property !== 'string' || !this.isCrossOriginAccessibleWindowPropertyName(property)) return;
    const accessorDocument = accessor.activeDocument;
    const accessedDocument = accessed.activeDocument;
    if (!accessorDocument.isFullyActive() || !accessedDocument.isFullyActive()) {
      throw new InternalError('COOP access reporting requires fully active documents');
    }
    const accessorTop = accessor.topLevelBrowsingContext!;
    const accessedTop = accessed.topLevelBrowsingContext!;
    const accessorTopDocument = accessorTop.activeDocument;
    const accessedTopDocument = accessedTop.activeDocument;
    const accessorAncestors = getSameOriginAncestorContexts(accessor, accessorTopDocument.origin);
    const accessedAncestors = getSameOriginAncestorContexts(accessed, accessedTopDocument.origin);
    if (accessorAncestors === null || accessedAncestors === null) return;
    if (accessorTop.virtualBrowsingContextGroupID === accessedTop.virtualBrowsingContextGroupID) return;

    let relationship: OpenerPolicyAccessReportParams['relationship'] = 'none';
    if (accessedTop.openerBrowsingContext !== null && accessorAncestors.includes(accessedTop.openerBrowsingContext)) {
      relationship = 'accessor-is-opener';
    }
    if (accessorTop.openerBrowsingContext !== null && accessedAncestors.includes(accessorTop.openerBrowsingContext)) {
      relationship = 'accessor-is-openee';
    }
    OpenerPolicy.queueAccessReports({
      relationship,
      accessorCOOP: accessorTopDocument.openerPolicy,
      accessedCOOP: accessedTopDocument.openerPolicy,
      accessorURL: accessorDocument.url,
      accessedURL: accessedDocument.url,
      accessorInitialURL: accessorTop.initialURL,
      accessedInitialURL: accessedTop.initialURL,
      accessorOrigin: accessorDocument.origin,
      accessedOrigin: accessedDocument.origin,
      accessorCreatorOrigin: accessorTop.openerOriginAtCreation,
      accessedCreatorOrigin: accessedTop.openerOriginAtCreation,
      accessorReferrer: accessorTopDocument.referrer,
      accessedReferrer: accessedTopDocument.referrer,
      propertyName: property,
    }, this.#context.getEnvironment());
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#crossoriginproperties-(-o-)
  crossOriginProperties(object: object): readonly CrossOriginProperty[] {
    const record = this.#requireRecord(object);
    return prepareCrossOriginObject(record.assembled)!;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#crossoriginpropertyfallback-(-p-)
  crossOriginPropertyFallback(property: string | symbol): PropertyDescriptor {
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
  // SPEC_MISMATCH: CrossOriginGetOwnPropertyHelper (O, P)
  crossOriginGetOwnPropertyHelper(object: object, property: string | symbol, storage = object): PropertyDescriptor | undefined {
    const entry = this.crossOriginProperties(object).find((entry) => entry.property === property);
    if (!entry) return undefined;

    const record = this.#requireRecord(object);
    let callers = CrossOriginObjectBinding.#descriptorMaps.get(record);
    if (!callers) CrossOriginObjectBinding.#descriptorMaps.set(record, callers = new WeakMap());
    const env = this.#context.getEnvironment();
    let descriptors = callers.get(env);
    if (!descriptors) callers.set(env, descriptors = new Map<string | symbol, PropertyDescriptor>());
    const cached = descriptors.get(property);
    if (cached) return cached;

    // Location supplies its private store; Window still supplies its ordinary platform target.
    const original = Reflect.getOwnPropertyDescriptor(storage, property);
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
  crossOriginGet(object: object, property: string | symbol, receiver: unknown): unknown {
    const descriptor = this.#context.realm.reflectGetOwnPropertyDescriptor(object, property);
    return this.#crossOriginGetWithDescriptor(descriptor, receiver);
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#crossoriginset-(-o,-p,-v,-receiver-)
  crossOriginSet(object: object, property: string | symbol, value: unknown, receiver: unknown): boolean {
    const descriptor = this.#context.realm.reflectGetOwnPropertyDescriptor(object, property);
    return this.#crossOriginSetWithDescriptor(descriptor, value, receiver);
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#crossoriginownpropertykeys-(-o-)
  crossOriginOwnPropertyKeys(object: object): (string | symbol)[] {
    return [...this.crossOriginProperties(object).map((entry) => entry.property), ...fallbackKeys];
  }

  /** Finish CrossOriginGet after resolving the own descriptor for this caller. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#crossoriginget-(-o,-p,-receiver-)
  // SPEC_MISMATCH: CrossOriginGet (O, P, Receiver)
  #crossOriginGetWithDescriptor(descriptor: PropertyDescriptor | undefined, receiver: unknown): unknown {
    if (!descriptor) throw new InternalError('CrossOriginGet requires an own property descriptor');
    if (isDataDescriptor(descriptor)) return descriptor.value;
    if (!descriptor.get) throw new this.#context.DOMException('Cross-origin property is not readable', 'SecurityError');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Supply the descriptor's receiver explicitly.
    return Reflect.apply(descriptor.get, receiver, []);
  }

  /** Finish CrossOriginSet after resolving the own descriptor for this caller. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#crossoriginset-(-o,-p,-v,-receiver-)
  // SPEC_MISMATCH: CrossOriginSet (O, P, V, Receiver)
  #crossOriginSetWithDescriptor(
    descriptor: PropertyDescriptor | undefined,
    value: unknown,
    receiver: unknown,
  ): boolean {
    if (!descriptor) throw new InternalError('CrossOriginSet requires an own property descriptor');
    if (!descriptor.set) throw new this.#context.DOMException('Cross-origin property is not writable', 'SecurityError');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Supply the descriptor's receiver explicitly.
    Reflect.apply(descriptor.set, receiver, [value]);
    return true;
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
type CrossOriginPropertyDescriptorMap = WeakMap<BrowletEnvironment, Map<string | symbol, PropertyDescriptor>>;
type CrossOriginMember = { kind: string; name?: string; static?: boolean; extendedAttributes?: ExtendedAttribute[]; };

const interfaceProperties = new WeakMap<AssembledInterface, readonly CrossOriginProperty[] | null>();
const fallbackKeys: (string | symbol)[] = ['then', Symbol.toStringTag, Symbol.hasInstance, Symbol.isConcatSpreadable];

/** Collect the live inclusive ancestry, rejecting a cross-origin participant before reporting. */
function getSameOriginAncestorContexts(context: BrowsingContext, topOrigin: Origin): BrowsingContext[] | null {
  const ancestors: BrowsingContext[] = [];
  for (const navigable of context.activeDocument.getInclusiveAncestorNavigables()) {
    if (!areSameOrigin(navigable.activeDocument!.origin, topOrigin)) return null;
    ancestors.push(navigable.activeBrowsingContext!);
  }
  return ancestors;
}

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
