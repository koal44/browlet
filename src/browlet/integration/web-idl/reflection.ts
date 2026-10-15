import { asciiLower, toScalarValueString } from '../../../infra/index';
import {
  getImplementationObject, type AssembledInterface, type AttributeBinding,
  type IDLAttribute, type IDLFrozenArrayType, type IDLInterfaceType, type IDLType,
  type ReflectionExtendedAttribute, type StampedImplInstance, type StampedPlatformObject,
} from '../../../web-idl/index';

import type { EnumeratedAttribute } from '../../html/microsyntaxes/index';
import type { TokenListAttribute } from '../../dom/token-list';
import {
  type ElementConstructor, type ReflectionRules, booleanReflection, stringReflection, nullableStringReflection, scalarStringReflection,
  getReflectedKeyword, reflectLong, reflectUnsignedLong, reflectDouble,
} from '../../html/reflection/index';
import type { ElementImpl } from '../../dom/nodes/index';
import { ElementInternalsImpl } from '../../dom/nodes/html/custom-elements/index';
import type { BrowletEnvironment } from '../../environment';

import { type ReflectedTarget, type ReflectionTargetSteps, elementReflection, internalsReflection } from './reflection-target';

/** Prepare owner-specific accessors from trusted declarations, checked by the declaration tests. */
// BINDING_INTEGRATION: HTML supplies reflection rules; Web IDL retains conversion and projection.
// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflecting-content-attributes-in-idl-attributes
// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#using-reflect-via-idl-extended-attributes
export function prepareReflectedAttribute(
  member: IDLAttribute, owners: AssembledInterface[],
): Map<AssembledInterface, OwnerReflectionBinding> | undefined {
  const reflection = member.extendedAttributes?.find((attribute) => attribute.kind === 'reflection');
  if (!reflection) return;
  const name = reflection.attributeName ?? asciiLower(member.name);
  const type = member.type;
  const nullable = type.kind === 'nullable';
  const inner = nullable ? type.innerType : type;

  let sharedAccessors: ReflectionBinding | ElementReflectionBinding | undefined;
  if (reflection.name === 'ReflectTokens') {
    const attribute = reflection.tokenList as TokenListAttribute;
    sharedAccessors = {
      get() { return this.getAttributeTokenList(attribute); },
    } satisfies ElementReflectionBinding;
  } else if (nullable && inner.kind === 'frozen-array') {
    // HTML reflection requires an Element interface here; the declaration tests check that constraint.
    sharedAccessors = createElementArrayBinding(name, inner as IDLFrozenArrayType<IDLInterfaceType>);
  } else if (nullable && inner.kind === 'interface') {
    const targetConstructor = getElementConstructor(inner);
    sharedAccessors = {
      get() { return this.getAssociatedElements(name, targetConstructor, false); },
      set(_ctx, value) { this.setAssociatedElements(name, value as ElementImpl | null); },
    } satisfies ReflectionBinding;
  }
  if (sharedAccessors) {
    const binding = createAttributeBinding(member, reflection, sharedAccessors);
    return new Map(owners.map((owner) => [owner, binding]));
  }

  const rules = getReflectionRules(type, reflection);
  const bindings = new Map<AssembledInterface, OwnerReflectionBinding>();
  let elementAccessors: ElementReflectionBinding | undefined;
  let internalsAccessors: InternalsReflectionBinding | undefined;
  const isURL = reflection.name === 'ReflectURL';
  for (const owner of owners) {
    const implementation = owner.primary.implementation!.implClass;
    const accessors = implementation === ElementInternalsImpl || implementation.prototype instanceof ElementInternalsImpl
      ? internalsAccessors ??= createAttributeBinding(member, reflection, createValueBinding(name, rules, isURL, internalsReflection))
      : elementAccessors ??= createAttributeBinding(member, reflection, createValueBinding(name, rules, isURL, elementReflection));
    bindings.set(owner, accessors);
  }
  return bindings;
}

type ReflectionBinding = AttributeBinding<BrowletEnvironment, ReflectedTarget>;
type ElementReflectionBinding = AttributeBinding<BrowletEnvironment, ElementImpl>;
type InternalsReflectionBinding = AttributeBinding<BrowletEnvironment, ElementInternalsImpl>;

type OwnerReflectionBinding = ReflectionBinding | ElementReflectionBinding | InternalsReflectionBinding;

/** Select primitive rules once, after the declaration tests have checked the supported IDL types. */
function getReflectionRules(type: IDLType, reflection: ReflectionExtendedAttribute): ReflectionRules<unknown> {
  const nullable = type.kind === 'nullable';
  const inner = nullable ? type.innerType : type;
  const mode = reflection.name;
  if (inner.kind === 'boolean') return booleanReflection;
  if (inner.kind === 'string') {
    if (inner.name === 'USVString') return scalarStringReflection;
    if (mode !== 'ReflectEnumerated') return nullable ? nullableStringReflection : stringReflection;
    const definition = reflection.enumerated as EnumeratedAttribute<PropertyKey>;
    return {
      get: nullable
        ? (value) => getReflectedKeyword(value, definition)
        : (value) => getReflectedKeyword(value, definition) ?? '',
      set: (value) => value as string | null,
    };
  }
  const defaultValue = reflection.default ? Number(reflection.default.value) : undefined;
  if (inner.kind === 'integer') {
    if (inner.name === 'long') return reflectLong(mode === 'ReflectNonNegative', defaultValue);
    const range: [number, number] | undefined = reflection.range
      ? [Number(reflection.range[0]), Number(reflection.range[1])] : undefined;
    return reflectUnsignedLong(mode === 'ReflectPositive', mode === 'ReflectPositiveWithFallback', range, defaultValue);
  }
  // The declaration audit leaves only double here.
  // SPEC_GAP(reflect-positive-fallback-double): The declaration tests exclude the undefined double/fallback combination; no HTML member uses it.
  return reflectDouble(mode === 'ReflectPositive', defaultValue);
}

/** Preserve a custom getter and omit readonly setters when constructing the final binding. */
function createAttributeBinding<T extends ReflectedTarget>(
  member: IDLAttribute, reflection: ReflectionExtendedAttribute, accessors: AttributeBinding<BrowletEnvironment, T>,
): AttributeBinding<BrowletEnvironment, T> {
  return {
    get: reflection.name === 'ReflectSetter'
      ? member.get ?? function() { return Reflect.get(this, member.name); } : accessors.get,
    set: member.readonly ? undefined : accessors.set,
  };
}

/** Retain array identity while the associated implementation elements remain unchanged. */
function createElementArrayBinding(name: string, type: IDLFrozenArrayType<IDLInterfaceType>): ReflectionBinding {
  const targetConstructor = getElementConstructor(type.elementType);
  const cache = new WeakMap<ReflectedTarget, { elements: ElementImpl[] | null; array: readonly unknown[] | null; }>();
  return {
    get(ctx) {
      const elements = this.getAssociatedElements(name, targetConstructor, true);
      const previous = cache.get(this);
      // SPEC_CLASH(reflected-elements-initial-empty): Follow Chromium/WebKit: create [] on the first empty result; HTML/Firefox reuse an initial null cache.
      if (previous && equalElements(elements, previous.elements)) return previous.array;
      const array = elements === null ? null : ctx.createFrozenArray(elements, type);
      cache.set(this, { elements, array });
      return array;
    },
    set(_ctx, value) {
      // FrozenArray conversion already checked and projected each declared Element interface.
      // Read those established associations without repeating interface or world validation.
      const platforms = value as readonly StampedPlatformObject[] | null;
      const elements = platforms === null ? null : platforms.map((element) =>
        getImplementationObject(element) as StampedImplInstance<ElementImpl>);
      this.setAssociatedElements(name, elements);
    },
  };
}

/** Close over the owner's attribute operations so invocations need no target-kind dispatch. */
function createValueBinding<T extends ReflectedTarget>(
  name: string, rules: ReflectionRules<unknown>, isURL: boolean, target: ReflectionTargetSteps<T>,
): AttributeBinding<BrowletEnvironment, T> {
  const { get: read, set: write } = rules;
  const { getElement, getContentAttribute, setContentAttribute, deleteContentAttribute } = target;
  return {
    get: isURL
      ? function() {
        const value = getContentAttribute(this, name);
        if (value === null) return '';
        return getElement(this).nodeDocument.encodingParseAndSerializeURL(value) ?? toScalarValueString(value);
      }
      : function() { return read(getContentAttribute(this, name)); },
    set(_ctx, value) {
      const text = write(value);
      if (text === null) deleteContentAttribute(this, name);
      else if (text !== undefined) setContentAttribute(this, name, text);
    },
  };
}

/** Retrieve the target element's implementation constructor selected by Web IDL assembly. */
function getElementConstructor(type: IDLInterfaceType): ElementConstructor {
  return type.assembled.primary.implementation!.implClass as ElementConstructor;
}

function equalElements(first: ElementImpl[] | null, second: ElementImpl[] | null): boolean {
  return first === second || first !== null && second !== null &&
    first.length === second.length && first.every((element, index) => element === second[index]);
}
